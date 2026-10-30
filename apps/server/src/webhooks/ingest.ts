import { randomUUID } from 'node:crypto';
import { tx, type PoolClient } from '@pt/db';
import {
  buildServerEvent, canTransition, formatMoney, isPurchaseTransition, isReversal, sha256, UTM_KEYS,
  type PaymentStatus,
} from '@pt/domain';
import {
  ADAPTERS, extractProductIds, idempotencyKey, purchaseEventId, refundEventId,
  type GatewayAdapter, type InboundRequest, type NormalizedPayment, type NormalizedServerEvent, type Provider,
} from '@pt/gateways';
import type { Ctx } from '../context.js';
import { enqueueCapi, raiseAlert } from '../capi/outbox.js';
import { sha256Hex } from '../lib/crypto.js';
import { sendPushToOrg } from '../notifications/push.js';
import { emailLookupHash, findIdentity } from '../tracking/identity.js';

/**
 * Pipeline de webhook (ADR-004):
 *   origem autenticada → assinatura do gateway → normalização → idempotência →
 *   [transação: pagamento (máquina de estados) + outbox CAPI + recibo] → 2xx.
 * O envio à Meta é feito pelo worker; uma falha da Meta nunca perde o evento.
 */

export interface IngestInput {
  provider: Provider;
  token: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  /** corpo já decodificado de form-urlencoded, quando for o caso */
  formBody?: Record<string, unknown> | null;
}

export interface IngestResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

interface Integration {
  id: string;
  org_id: string;
  provider: Provider;
  secret_enc: string | null;
  default_pixel_id: string | null;
  amount_unit: 'major' | 'minor';
  active: boolean;
  /** false = modo sombra: registra tudo, mas não envia nada à Meta */
  send_to_meta: boolean;
}

interface Pixel {
  id: string;
  meta_pixel_id: string;
  currency: string;
  active: boolean;
  capi_token_enc: string | null;
  send_refund_event: boolean;
  name: string;
}

const MAX_EVENT_AGE_S = 6 * 24 * 3600; // a Meta rejeita eventos com mais de 7 dias

function parsePayload(raw: string, form?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (form && Object.keys(form).length) return form;
  const t = raw.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    const params = new URLSearchParams(t);
    const o: Record<string, unknown> = {};
    for (const [k, v] of params) o[k] = v;
    return Object.keys(o).length ? o : null;
  }
}

interface ReceiptArgs {
  orgId: string | null; integrationId: string | null; provider: string; correlationId: string; idemKey?: string | null;
  signatureOk?: boolean | null; signatureMethod?: string | null; outcome: string; reason?: string | null;
  gatewayEvent?: string | null; transactionId?: string | null; paymentId?: string | null; bodySha: string; bodyEnc?: string | null; ms: number;
}
type ReceiptBase = Omit<ReceiptArgs, 'outcome' | 'ms'>;

async function receipt(c: { query: PoolClient['query'] } | Ctx['db'], r: ReceiptArgs): Promise<number> {
  const q = await c.query(
    `INSERT INTO webhook_receipts(org_id, integration_id, provider, correlation_id, idempotency_key, signature_ok, signature_method,
                                  outcome, reason, gateway_event, transaction_id, payment_id, body_sha256, body_enc, processing_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [r.orgId, r.integrationId, r.provider, r.correlationId, r.idemKey ?? null, r.signatureOk ?? null, r.signatureMethod ?? null,
      r.outcome, r.reason ?? null, r.gatewayEvent?.slice(0, 120) ?? null, r.transactionId?.slice(0, 128) ?? null,
      r.paymentId ?? null, r.bodySha, r.bodyEnc ?? null, r.ms],
  );
  return Number(q.rows[0].id);
}

async function loadPixel(c: { query: PoolClient['query'] }, orgId: string, id: string | null): Promise<Pixel | null> {
  if (!id) return null;
  const r = await c.query('SELECT id, meta_pixel_id, currency, active, capi_token_enc, send_refund_event, name FROM pixels WHERE id = $1 AND org_id = $2', [id, orgId]);
  return r.rows[0] ? { ...r.rows[0], currency: String(r.rows[0].currency).trim() } : null;
}

/** Roteamento: produto cadastrado no pixel (mesma org) → pixel padrão da integração → pixel único ativo. */
export async function resolvePixel(
  c: { query: PoolClient['query'] }, orgId: string, productIds: string[], defaultPixelId: string | null,
): Promise<Pixel | null> {
  if (productIds.length) {
    const r = await c.query(
      `SELECT pp.pixel_id, array_position($2::text[], pp.product_id) AS pos FROM pixel_products pp
        WHERE pp.org_id = $1 AND pp.product_id = ANY($2) ORDER BY pos LIMIT 1`,
      [orgId, productIds],
    );
    if (r.rows[0]) return loadPixel(c, orgId, r.rows[0].pixel_id);
  }
  if (defaultPixelId) return loadPixel(c, orgId, defaultPixelId);
  const only = await c.query('SELECT id FROM pixels WHERE org_id = $1 AND active ORDER BY created_at LIMIT 2', [orgId]);
  return only.rowCount === 1 ? loadPixel(c, orgId, only.rows[0].id) : null;
}

export async function ingestWebhook(ctx: Ctx, input: IngestInput): Promise<IngestResult> {
  const started = Date.now();
  const correlationId = randomUUID();
  const bodySha = sha256Hex(input.rawBody);
  const adapter: GatewayAdapter = ADAPTERS[input.provider];
  const ms = () => Date.now() - started;
  const base = { provider: input.provider, correlationId, bodySha };

  const ir = await ctx.db.query<Integration>(
    'SELECT id, org_id, provider, secret_enc, default_pixel_id, amount_unit, active, send_to_meta FROM integrations WHERE token_hash = $1 AND provider = $2',
    [sha256Hex(input.token), input.provider],
  );
  const integration = ir.rows[0];
  if (!integration || !integration.active) {
    await receipt(ctx.db, { ...base, orgId: integration?.org_id ?? null, integrationId: integration?.id ?? null, outcome: 'rejected', reason: integration ? 'integration_inactive' : 'invalid_token', ms: ms() });
    return { httpStatus: 401, body: { success: false, error: 'Invalid integration token', correlationId } };
  }
  const ib = { ...base, orgId: integration.org_id, integrationId: integration.id };

  const payload = parsePayload(input.rawBody, input.formBody);
  if (!payload) {
    // corpo vazio = teste de conectividade do painel do gateway (comportamento legado)
    if (!input.rawBody.trim()) return { httpStatus: 200, body: { success: true, ping: true, correlationId } };
    await receipt(ctx.db, { ...ib, outcome: 'rejected', reason: 'invalid_body', ms: ms() });
    return { httpStatus: 400, body: { success: false, error: 'Invalid body', correlationId } };
  }
  const req: InboundRequest = { rawBody: input.rawBody, headers: input.headers, query: input.query, payload };
  if (adapter.isTestPing(req)) return { httpStatus: 200, body: { success: true, test: true, correlationId } };

  const secret = ctx.box.decryptNullable(integration.secret_enc);
  const sig = adapter.verify(req, secret);
  if (!sig.ok) {
    await receipt(ctx.db, { ...ib, signatureOk: false, signatureMethod: sig.method, outcome: 'rejected', reason: sig.reason ?? 'invalid_signature', ms: ms() });
    ctx.log.warn({ correlationId, provider: input.provider, reason: sig.reason }, 'webhook rejeitado (assinatura)');
    return { httpStatus: 401, body: { success: false, error: 'Invalid signature', reason: sig.reason, correlationId } };
  }
  const sigInfo = { signatureOk: true, signatureMethod: sig.method };

  // Teste de conexão do painel do checkout: valida URL, token e assinatura sem registrar venda
  // nem enviar nada à Meta (o "testar" antigo mandava um Purchase falso).
  if (input.headers['x-paytrack-test'] === '1') {
    await receipt(ctx.db, { ...ib, ...sigInfo, outcome: 'ignored', reason: 'connection_test', ms: ms() });
    return {
      httpStatus: 200,
      body: { success: true, test: true, signature: secret ? 'valid' : 'not_configured', sendToMeta: integration.send_to_meta, correlationId },
    };
  }
  const bodyEnc = ctx.box.encrypt(input.rawBody);

  const defaultPixel = await loadPixel(ctx.db, integration.org_id, integration.default_pixel_id);
  const orgCur = await ctx.db.query<{ reporting_currency: string }>('SELECT reporting_currency FROM organizations WHERE id = $1', [integration.org_id]);
  const defaultCurrency = defaultPixel?.currency ?? String(orgCur.rows[0]?.reporting_currency ?? 'BRL').trim();
  const normalized = adapter.normalize(payload, { defaultCurrency, amountUnit: integration.amount_unit, now: ctx.now });

  await ctx.db.query('UPDATE integrations SET last_received_at = now() WHERE id = $1', [integration.id]);

  if (normalized.kind === 'ignored') {
    await receipt(ctx.db, { ...ib, ...sigInfo, outcome: 'ignored', reason: normalized.reason, gatewayEvent: normalized.gatewayEvent, transactionId: normalized.transactionId, ms: ms() });
    return { httpStatus: 200, body: { success: true, queued: false, ignored: true, reason: normalized.reason, correlationId } };
  }

  const productIds = [
    ...normalized.products.map((p) => p.id).filter((x): x is string => !!x),
    ...(input.provider === 'checkout' ? extractProductIds(payload) : []),
  ];

  if (normalized.kind === 'event') {
    return ingestServerEvent(ctx, integration, normalized, productIds, { ...ib, ...sigInfo, bodyEnc }, ms);
  }

  try {
    const out = await tx(ctx.db, (c) => applyPayment(ctx, c, integration, normalized, productIds, { ...ib, ...sigInfo, bodyEnc }, ms));
    if (out.purchase) {
      const p = out.purchase;
      const paymentId = (out.response as { paymentId?: string }).paymentId;
      const sale = { kind: 'sale' as const, title: 'Venda aprovada! 🔥', url: paymentId ? `/vendas/${paymentId}` : '/vendas', tag: `sale-${normalized.transactionId}` };
      sendPushToOrg(ctx, integration.org_id,
        { ...sale, body: `${p.amount} • ${p.pixelName ?? ADAPTERS[input.provider].label}` },
        { ...sale, body: `${p.amount} • ${ADAPTERS[input.provider].label}` }, // modo privado: sem o nome do pixel
      ).catch((e) => ctx.log.warn({ err: String(e) }, 'push falhou'));
    }
    return { httpStatus: 200, body: { success: true, correlationId, ...out.response } };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      // corrida com um webhook idêntico simultâneo: o outro venceu (cenário 18)
      await receipt(ctx.db, { ...ib, ...sigInfo, idemKey: null, outcome: 'duplicate', reason: 'concurrent_duplicate', transactionId: normalized.transactionId, ms: ms() });
      return { httpStatus: 200, body: { success: true, duplicate: true, correlationId } };
    }
    ctx.log.error({ correlationId, err: (e as Error).message }, 'falha ao processar webhook');
    await receipt(ctx.db, { ...ib, ...sigInfo, outcome: 'failed', reason: (e as Error).message.slice(0, 300), transactionId: normalized.transactionId, bodyEnc, ms: ms() }).catch(() => undefined);
    // 5xx: nada foi gravado; o gateway reenviará e o processamento é idempotente (corrige P-05)
    return { httpStatus: 500, body: { success: false, error: 'Internal error', correlationId } };
  }
}

async function applyPayment(
  ctx: Ctx,
  c: PoolClient,
  integration: Integration,
  n: NormalizedPayment,
  productIds: string[],
  rb: ReceiptBase,
  ms: () => number,
) {
  const orgId = integration.org_id;
  const idemKey = idempotencyKey(n);
  const dup = await c.query(
    `SELECT payment_id FROM webhook_receipts WHERE integration_id = $1 AND idempotency_key = $2 AND outcome = 'processed' LIMIT 1`,
    [integration.id, idemKey],
  );
  if (dup.rowCount) {
    await receipt(c, { ...rb, idemKey: null, outcome: 'duplicate', reason: 'webhook_already_processed', gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: dup.rows[0].payment_id, bodyEnc: null, ms: ms() });
    return { purchase: null, response: { duplicate: true, reason: 'webhook already processed' } };
  }

  const pixel = await resolvePixel(c, orgId, productIds, integration.default_pixel_id);
  const t = n.tracking;
  const utm = (k: (typeof UTM_KEYS)[number]) => t[k] ?? null;

  // upsert + lock da linha do pagamento
  const ins = await c.query(
    `INSERT INTO payments(org_id, provider, transaction_id, status, integration_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, provider, transaction_id) DO NOTHING RETURNING id`,
    [orgId, n.provider, n.transactionId, n.status, integration.id],
  );
  const isNew = !!ins.rowCount;
  const cur = await c.query(
    'SELECT id, status, pixel_id, amount_minor, currency, approved_at FROM payments WHERE org_id = $1 AND provider = $2 AND transaction_id = $3 FOR UPDATE',
    [orgId, n.provider, n.transactionId],
  );
  const payment = cur.rows[0];
  const from: PaymentStatus | null = isNew ? null : payment.status;
  const to = n.status;

  if (!isNew && !canTransition(from, to)) {
    const reason = from === to ? 'status_unchanged' : `out_of_order_transition_${from}_to_${to}`;
    await receipt(c, { ...rb, idemKey, outcome: 'duplicate', reason, gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: payment.id, ms: ms() });
    return { purchase: null, response: { duplicate: true, reason, status: from } };
  }

  const at = n.occurredAt ?? ctx.now();
  const amountMinor = n.amountMinor ?? payment.amount_minor ?? null;
  const currency = n.amountMinor !== null ? n.currency : (payment.currency?.trim() ?? n.currency);
  await c.query(
    `UPDATE payments SET status = $2, amount_minor = $3, currency = $4, pixel_id = COALESCE(pixel_id, $5),
            customer_email_hash = COALESCE($6, customer_email_hash), products = CASE WHEN $7::jsonb = '[]'::jsonb THEN products ELSE $7::jsonb END,
            utm_source = COALESCE($8, utm_source), utm_medium = COALESCE($9, utm_medium), utm_campaign = COALESCE($10, utm_campaign),
            utm_content = COALESCE($11, utm_content), utm_term = COALESCE($12, utm_term), utm_id = COALESCE($13, utm_id),
            pending_at  = CASE WHEN $2 = 'pending' THEN COALESCE(pending_at, $14) ELSE pending_at END,
            approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, $14) ELSE approved_at END,
            reversed_at = CASE WHEN $2 IN ('refunded', 'chargeback') THEN $14 ELSE reversed_at END,
            canceled_at = CASE WHEN $2 IN ('canceled', 'failed') THEN $14 ELSE canceled_at END,
            updated_at = now()
      WHERE id = $1`,
    [payment.id, to, amountMinor, currency, pixel?.id ?? null, emailLookupHash(n.customer.email),
      JSON.stringify(n.products.map((p) => ({ ...p, priceMinor: p.priceMinor?.toString() ?? null }))),
      utm('utm_source'), utm('utm_medium'), utm('utm_campaign'), utm('utm_content'), utm('utm_term'), utm('utm_id'), at],
  );

  const receiptId = await receipt(c, { ...rb, idemKey, outcome: 'processed', gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: payment.id, ms: ms() });
  await c.query('INSERT INTO payment_transitions(payment_id, from_status, to_status, receipt_id, occurred_at) VALUES ($1, $2, $3, $4, $5)', [payment.id, from, to, receiptId, at]);

  const effectivePixel = pixel ?? (payment.pixel_id ? await loadPixel(c, orgId, payment.pixel_id) : null);
  let queued = false;
  let purchase: { amount: string; pixelName: string | null } | null = null;

  if (isPurchaseTransition(from, to)) {
    purchase = { amount: amountMinor !== null && currency ? formatMoney(amountMinor, currency) : 'valor não informado', pixelName: effectivePixel?.name ?? null };
    if (!effectivePixel) {
      await raiseAlert(c, orgId, {
        kind: 'sale_without_pixel', severity: 'warning', dedupKey: `sale_without_pixel:${integration.id}`,
        title: 'Venda aprovada sem pixel associado',
        detail: 'Cadastre o ID do produto em um pixel ou defina o pixel padrão da integração para enviar o Purchase à Meta.',
      });
    } else if (!amountMinor || amountMinor <= 0n || !currency) {
      await raiseAlert(c, orgId, {
        kind: 'purchase_without_value', severity: 'warning', dedupKey: `purchase_without_value:${integration.id}`,
        title: 'Venda aprovada sem valor', detail: `Transação ${n.transactionId}: o gateway não informou o valor; Purchase não enviado à Meta.`,
      });
    } else {
      const event = await buildPaymentEvent(c, orgId, n, 'Purchase', purchaseEventId(n), amountMinor, currency, at, ctx.now());
      await c.query('UPDATE payments SET purchase_event_id = $2 WHERE id = $1', [payment.id, event.event_id]);
      if (integration.send_to_meta) queued = (await enqueueCapi(c, { orgId, pixelId: effectivePixel.id, event, paymentId: payment.id, correlationId: rb.correlationId })) !== null;
    }
  } else if (isReversal(to) && from === 'approved' && effectivePixel?.send_refund_event) {
    // comportamento legado: evento customizado "Refund" (sem valor); o faturamento é abatido em payments
    const event = await buildPaymentEvent(c, orgId, n, 'Refund', refundEventId(n), null, null, at, ctx.now());
    if (integration.send_to_meta) queued = (await enqueueCapi(c, { orgId, pixelId: effectivePixel.id, event, paymentId: payment.id, correlationId: rb.correlationId })) !== null;
  }

  return {
    purchase,
    response: { processed: true, paymentId: payment.id, status: to, previousStatus: from, queued, ...(integration.send_to_meta ? {} : { shadow: true }), eventName: queued ? (to === 'approved' ? 'Purchase' : 'Refund') : null },
  };
}

async function buildPaymentEvent(
  c: { query: PoolClient['query'] }, orgId: string, n: NormalizedPayment | NormalizedServerEvent,
  eventName: 'Purchase' | 'Refund' | NormalizedServerEvent['eventName'], eventId: string,
  amountMinor: bigint | null, currency: string | null, at: Date, now: Date,
) {
  const t = n.tracking;
  const identity = await findIdentity(c, orgId, { xid: t.externalId ?? n.customer.externalId, email: n.customer.email, phone: n.customer.phone });
  const nowS = Math.floor(now.getTime() / 1000);
  const atS = Math.floor(at.getTime() / 1000);
  const eventTime = atS > nowS || nowS - atS > MAX_EVENT_AGE_S ? nowS : atS;
  const utms = Object.fromEntries(UTM_KEYS.map((k) => [k, t[k] ?? identity?.[k] ?? null]));
  // xid real do navegador tem prioridade sobre o fallback "user_<md5>" (legado)
  const xid = identity?.xid ?? t.externalId ?? n.customer.externalId ?? null;
  return buildServerEvent({
    eventName: eventName as never,
    eventId,
    eventTime,
    eventSourceUrl: t.eventSourceUrl ?? identity?.source_url ?? null,
    customer: { ...n.customer, externalId: xid, country: n.customer.country ?? identity?.country ?? null },
    // IP/UA só do navegador do comprador — nunca do gateway (legado: P-37/BUGFIX)
    tracking: { fbp: t.fbp ?? identity?.fbp, fbc: t.fbc ?? identity?.fbc, clientIp: t.clientIp ?? identity?.client_ip, userAgent: t.userAgent ?? identity?.user_agent },
    valueMinor: amountMinor,
    currency,
    products: n.products,
    orderId: n.transactionId,
    utms,
  });
}

async function ingestServerEvent(
  ctx: Ctx, integration: Integration, n: NormalizedServerEvent, productIds: string[],
  rb: ReceiptBase, ms: () => number,
): Promise<IngestResult> {
  const orgId = integration.org_id;
  return tx(ctx.db, async (c) => {
    const pixel = await resolvePixel(c, orgId, productIds, integration.default_pixel_id);
    if (!pixel) {
      await receipt(c, { ...rb, outcome: 'ignored', reason: 'no_pixel_for_event', gatewayEvent: n.eventName, ms: ms() });
      return { httpStatus: 200, body: { success: true, queued: false, ignored: true, reason: 'no pixel resolved', correlationId: rb.correlationId } };
    }
    const eventId = n.eventId ?? n.transactionId ?? `srv_${sha256(rb.bodySha + n.eventName).slice(0, 32)}`;
    const event = await buildPaymentEvent(c, orgId, n, n.eventName, eventId, n.amountMinor, n.currency, ctx.now(), ctx.now());
    const te = await c.query(
      `INSERT INTO tracking_events(org_id, pixel_id, event_name, event_id, source, value_minor, currency, match_keys)
       VALUES ($1,$2,$3,$4,'server',$5,$6,$7) ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
      [orgId, pixel.id, n.eventName, eventId, n.amountMinor, n.currency, Object.keys(event.user_data)],
    );
    if (!te.rowCount) {
      await receipt(c, { ...rb, outcome: 'duplicate', reason: 'event_already_received', gatewayEvent: n.eventName, ms: ms() });
      return { httpStatus: 200, body: { success: true, duplicate: true, correlationId: rb.correlationId } };
    }
    if (integration.send_to_meta) await enqueueCapi(c, { orgId, pixelId: pixel.id, event, trackingEventId: te.rows[0].id, correlationId: rb.correlationId });
    await receipt(c, { ...rb, outcome: 'processed', gatewayEvent: n.eventName, transactionId: n.transactionId, ms: ms() });
    return { httpStatus: 200, body: { success: true, queued: integration.send_to_meta, ...(integration.send_to_meta ? {} : { shadow: true }), event_name: n.eventName, event_id: eventId, correlationId: rb.correlationId } };
  });
}
