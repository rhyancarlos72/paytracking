import {
  classifyByEventName, mapEventName, resolveStatus, type MetaEventName, type PaymentStatus,
} from '@pt/domain';
import { createHmac } from 'node:crypto';
import type { GatewayAdapter, Normalized } from '../types.js';
import { amount, currencyOr, customerFrom, isObj, obj, pick, pickRaw, product, safeEqual, toDate, trackingFrom } from '../util.js';

/**
 * Checkout próprio — formato do legado /api/webhook.php preservado (aliases data/payload/
 * payer/customer, nomes de evento tolerantes). Autenticação: token de integração (Bearer)
 * validado pela API + assinatura HMAC-SHA256 OBRIGATÓRIA quando o segredo está configurado
 * (no legado era opcional mesmo configurada — P-10). Anti-replay opcional: se vier
 * X-Paytrack-Timestamp, a assinatura cobre `${timestamp}.${corpo}` e a janela é de 5 min.
 * Valores em REAIS (unidade maior), como no legado.
 */

const STATUS_KEYS = ['status', 'payment_status', 'paymentStatus', 'transaction_status', 'situacao', 'state', 'order_status', 'purchase_status', 'paymentState'];
const STATUS_OBJECTS = ['payment', 'transaction', 'order', 'charge', 'sale', 'pix'];
const SERVER_EVENTS: MetaEventName[] = ['Lead', 'ViewContent', 'AddToCart', 'AddPaymentInfo', 'PageView'];

const EVENT_ID_KEYS: Partial<Record<MetaEventName, string[]>> = {
  InitiateCheckout: ['initiate_checkout_event_id', 'initiateCheckoutEventId', 'ic_event_id'],
  Purchase: ['purchase_event_id', 'purchaseEventId', 'meta_purchase_event_id'],
  AddPaymentInfo: ['add_payment_info_event_id', 'addPaymentInfoEventId'],
  Lead: ['lead_event_id', 'leadEventId'],
};

function mergeAliases(body: Record<string, unknown>): Record<string, unknown> {
  let b = body;
  if (isObj(b.data)) b = { ...b.data, ...b };
  if (isObj(b.payload)) b = { ...b.payload, ...b };
  return b;
}

function collectStatuses(b: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (const k of STATUS_KEYS) if (typeof b[k] === 'string' || typeof b[k] === 'number') out.push(b[k]);
  for (const o of STATUS_OBJECTS) {
    const nested = obj(b[o]);
    for (const k of STATUS_KEYS) if (typeof nested[k] === 'string') out.push(nested[k]);
  }
  return out;
}

export function checkoutEventId(b: Record<string, unknown>, eventName: MetaEventName): string | null {
  const tracking = obj(b.tracking);
  for (const k of [...(EVENT_ID_KEYS[eventName] ?? []), 'event_id', 'meta_event_id']) {
    const v = pick(tracking, [k]) ?? pick(b, [k]);
    if (v && v.length <= 128) return v;
  }
  return null;
}

/** IDs de produto para roteamento (inclui o fallback de event_id "initiate_checkout_<id>_<ts>_"). */
export function extractProductIds(body: Record<string, unknown>): string[] {
  const b = mergeAliases(body);
  const vals: unknown[] = [];
  for (const k of ['product_id', 'produto_id', 'productId', 'produtoId', 'offer_id', 'offerId']) vals.push(b[k]);
  const p = obj(b.product);
  vals.push(p.id, p.product_id, p.produto_id);
  if (Array.isArray(b.products)) for (const x of b.products) { const o = obj(x); vals.push(o.id, o.product_id, o.produto_id); }
  const tracking = obj(b.tracking);
  for (const k of ['event_id', 'meta_event_id', 'initiate_checkout_event_id', 'purchase_event_id']) {
    for (const src of [b[k], tracking[k]]) {
      const m = typeof src === 'string' ? /^(?:pageview|initiate_checkout|add_payment_info|purchase)_(.+?)_\d{9,}_/i.exec(src) : null;
      if (m?.[1]) vals.push(m[1]);
    }
  }
  const ids = new Set<string>();
  for (const v of vals) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    let id = String(v).trim().replace(/\s+/g, '');
    if (/^\d+\.0+$/.test(id)) id = id.split('.')[0]!;
    if (id) ids.add(id);
  }
  return [...ids];
}

export function signCheckoutBody(rawBody: string, secret: string, timestamp?: string): string {
  const base = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  return 'sha256=' + createHmac('sha256', secret).update(base, 'utf8').digest('hex');
}

export const checkout: GatewayAdapter = {
  provider: 'checkout',
  label: 'Checkout próprio',
  authMethod: 'Bearer token + HMAC-SHA256 (X-Paytrack-Signature)',
  requiresSecret: false,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: true, method: 'bearer_token_only' };
    const sig = (req.headers['x-paytrack-signature'] ?? req.headers['x-signature'] ?? req.headers['x-hub-signature-256'] ?? '').trim();
    if (!sig) return { ok: false, method: 'hmac_sha256', reason: 'missing_signature' };
    const ts = req.headers['x-paytrack-timestamp']?.trim();
    if (ts) {
      const skew = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(skew) || skew > 300) return { ok: false, method: 'hmac_sha256_ts', reason: 'timestamp_out_of_window' };
    }
    const expected = signCheckoutBody(req.rawBody, secret, ts);
    const provided = sig.toLowerCase().startsWith('sha256=') ? sig.toLowerCase() : 'sha256=' + sig.toLowerCase();
    return { ok: safeEqual(expected, provided), method: ts ? 'hmac_sha256_ts' : 'hmac_sha256', reason: 'signature_mismatch' };
  },
  isTestPing: () => false,
  normalize(body, opts): Normalized {
    const b = mergeAliases(body);
    const webhookEvent = String(b.event ?? b.event_name ?? b.status ?? '');
    const metaEvent = mapEventName(webhookEvent);
    const transactionId = pick(b, ['transaction_id', 'transactionId', 'order_id', 'orderId', 'payment_id', 'paymentId', 'charge_id', 'chargeId', 'txid', 'id']);
    const currency = currencyOr(b.currency, opts.defaultCurrency);
    const value = amount(pickRaw(b, ['value', 'amount', 'total', 'valor', 'product_price', 'valor_total']), currency, 'major');

    const payer = obj(b.payer);
    const customerObj = { ...payer, ...obj(b.customer) };
    for (const k of ['email', 'customer_email', 'payer_email']) if (!customerObj.email && b[k]) customerObj.email = b[k];
    for (const k of ['phone', 'telephone', 'telefone', 'customer_phone']) if (!customerObj.phone && b[k]) customerObj.phone = b[k];
    for (const k of ['name', 'nome']) if (!customerObj.name && b[k]) customerObj.name = b[k];
    for (const k of ['first_name', 'last_name', 'document', 'cpf', 'city', 'cidade', 'state', 'estado', 'zip', 'cep', 'country']) {
      if (!customerObj[k] && b[k]) customerObj[k] = b[k];
    }
    const identification = obj(payer.identification);
    const customer = customerFrom(customerObj, {
      externalId: pick(obj(b.tracking), ['external_id', 'pt_xid']) ?? pick(b, ['external_id', 'pt_xid']) ?? pick(customerObj, ['external_id']),
      ...(identification.number ? { document: String(identification.number) } : {}),
      gender: pick(customerObj, ['gender']),
      birthdate: pick(customerObj, ['birthdate']),
    });

    let products = Array.isArray(b.products) ? b.products.map((x) => product(obj(x), currency, 'major')) : [];
    const prod = obj(b.product);
    if (!products.length && (Object.keys(prod).length || b.product_id || b.produto_id || b.product_sku)) {
      products = [{
        id: pick(prod, ['id']) ?? pick(b, ['product_id', 'produto_id', 'product_sku']),
        name: pick(prod, ['name', 'title']) ?? pick(b, ['product_name', 'produto_nome', 'content_name']),
        quantity: Number(prod.quantity ?? b.product_quantity ?? 1) || 1,
        priceMinor: amount(prod.price ?? b.product_price, currency, 'major') ?? value,
      }];
    }
    const tracking = trackingFrom(obj(b.tracking), obj(b.tracking_parameters), obj(b.utm), b, payer);
    const eventSourceUrl = pick(b, ['event_source_url', 'page_url', 'url']) ?? pick(obj(b.tracking), ['event_source_url', 'page_url', 'url']);
    if (eventSourceUrl) tracking.eventSourceUrl = eventSourceUrl;

    const resolved = resolveStatus(collectStatuses(b));
    // evento com nome desconhecido (ex.: sale.canceled, sale.chargeback) só vale se trouxer um status explícito
    if (!metaEvent && (resolved === 'none' || resolved === 'unknown')) {
      return { kind: 'ignored', provider: 'checkout', reason: 'unmapped_event', gatewayEvent: webhookEvent };
    }

    if (metaEvent && SERVER_EVENTS.includes(metaEvent)) {
      return {
        kind: 'event', provider: 'checkout', eventName: metaEvent, eventId: checkoutEventId(b, metaEvent),
        transactionId, amountMinor: value, currency, customer, products, tracking,
      };
    }

    let status: PaymentStatus | undefined;
    if (resolved === 'unknown') return { kind: 'ignored', provider: 'checkout', reason: 'unknown_status', gatewayEvent: webhookEvent };
    if (resolved !== 'none') status = resolved;
    else if (metaEvent === 'Refund') status = 'refunded';
    else if (metaEvent === 'InitiateCheckout') status = 'pending';
    else status = classifyByEventName(webhookEvent); // "purchase" sozinho NÃO confirma pagamento

    if (!status) {
      return { kind: 'ignored', provider: 'checkout', reason: 'purchase_without_payment_confirmation', gatewayEvent: webhookEvent };
    }
    if (!transactionId || transactionId.length > 128) {
      return { kind: 'ignored', provider: 'checkout', reason: 'missing_transaction_id', gatewayEvent: webhookEvent };
    }
    if (status === 'approved' && (value === null || value <= 0n)) {
      return { kind: 'ignored', provider: 'checkout', reason: 'purchase_without_positive_value', gatewayEvent: webhookEvent, transactionId };
    }
    const purchaseEventId = checkoutEventId(b, 'Purchase');
    if (purchaseEventId) tracking.purchaseEventId = purchaseEventId;
    return {
      kind: 'payment', provider: 'checkout', sourceEventId: null, transactionId, status, gatewayEvent: webhookEvent,
      amountMinor: value, currency, occurredAt: toDate(b.paid_at ?? b.approved_at), customer, products, tracking,
    };
  },
};
