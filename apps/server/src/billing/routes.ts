import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { tx } from '@pt/db';
import { safeEqual } from '@pt/gateways';
import type { Ctx } from '../context.js';
import { planState } from '../auth/service.js';
import { randomToken } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { jsonSafe, requireRole } from '../lib/http.js';
import { hit } from '../lib/rate-limit.js';
import { trackSubscriptionPurchase } from '../platform/tracking.js';

/**
 * Assinatura mensal via PIX Woovi/OpenPix (porta de app/billing.php).
 * Correção P-07: a renovação acontece UMA vez por cobrança (UPDATE … WHERE status <> 'paid'),
 * independentemente de quantas vezes/quais eventos a Woovi enviar.
 */

const PERIOD_DAYS = 30;

/** HMAC-SHA256 base64 do corpo em x-webhook-signature (esquema usado no legado; confirmar na doc oficial). */
export function wooviSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

export function billingRoutes(app: FastifyInstance, ctx: Ctx) {
  // público (página de vendas): o preço e o teste exibidos são sempre os que o sistema cobra
  app.get('/v1/public/plan', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { priceMinor: ctx.config.PLAN_PRICE_MINOR, currency: 'BRL', trialDays: ctx.config.PLAN_TRIAL_DAYS };
  });

  app.get('/v1/billing', async (req) => {
    const a = requireRole(req, 'viewer', { allowExpiredPlan: true });
    const charges = await ctx.db.query(
      `SELECT id, correlation_id, amount_minor, status, paid_at, expires_at, created_at, br_code, qr_code_image, payment_link_url
         FROM billing_charges WHERE org_id = $1 ORDER BY created_at DESC LIMIT 24`,
      [a.org.id],
    );
    return jsonSafe({
      plan: { ...planState(a.org, ctx.now()), expiresAt: a.org.plan_expires_at, priceMinor: ctx.config.PLAN_PRICE_MINOR, currency: 'BRL' },
      charges: charges.rows,
      wooviConfigured: !!ctx.config.WOOVI_APP_ID,
    });
  });

  app.post('/v1/billing/charge', async (req) => {
    const a = requireRole(req, 'owner', { allowExpiredPlan: true });
    await hit(ctx.db, `charge:org:${a.org.id}`, 10, 3600);
    if (!ctx.config.WOOVI_APP_ID) throw new AppError(503, 'billing_unavailable', 'Pagamento indisponível: WOOVI_APP_ID não configurado.');
    // reaproveita cobrança pendente ainda válida (idempotência do lado do cliente)
    const open = await ctx.db.query(
      `SELECT * FROM billing_charges WHERE org_id = $1 AND status = 'pending' AND expires_at > now() + interval '10 minutes' ORDER BY created_at DESC LIMIT 1`,
      [a.org.id],
    );
    if (open.rows[0]) return jsonSafe({ charge: open.rows[0], reused: true });
    const correlationID = `pt_sub_${a.org.id.replace(/-/g, '').slice(0, 12)}_${randomToken(8)}`;
    const res = await ctx.fetch(`${ctx.config.WOOVI_API_BASE}/api/v1/charge`, {
      method: 'POST',
      headers: { Authorization: ctx.config.WOOVI_APP_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationID, value: ctx.config.PLAN_PRICE_MINOR, comment: 'Assinatura mensal PayTracking',
        customer: { name: a.org.name.slice(0, 60), email: a.user.email }, expiresIn: 86_400,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !j.charge) {
      ctx.log.error({ http: res.status, error: j?.error ?? j?.message }, 'Woovi: falha ao criar cobrança');
      throw new AppError(502, 'billing_provider_error', `Falha ao criar cobrança PIX (HTTP ${res.status}). Tente novamente.`);
    }
    const c = j.charge;
    const ins = await ctx.db.query(
      `INSERT INTO billing_charges(org_id, correlation_id, provider_charge_id, amount_minor, br_code, qr_code_image, payment_link_url, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '24 hours') RETURNING *`,
      [a.org.id, correlationID, c.identifier ?? null, ctx.config.PLAN_PRICE_MINOR, c.brCode ?? null, c.qrCodeImage ?? null, c.paymentLinkUrl ?? null],
    );
    return jsonSafe({ charge: ins.rows[0], reused: false });
  });

  async function wooviWebhook(req: { rawBody?: string; headers: Record<string, unknown> }) {
    const raw = req.rawBody ?? '';
    const secret = ctx.config.WOOVI_WEBHOOK_SECRET;
    if (!secret) return { status: 503, body: { ok: false, error: 'webhook_secret_not_configured' } };
    const sig = String(req.headers['x-webhook-signature'] ?? '');
    if (!sig || !safeEqual(wooviSignature(raw, secret), sig)) return { status: 401, body: { ok: false, error: 'invalid_signature' } };
    let data: any;
    try { data = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, error: 'invalid_json' } }; }
    const event = String(data?.event ?? '');
    const charge = data?.charge ?? data?.pix?.charge ?? {};
    const paid = ['OPENPIX:CHARGE_COMPLETED', 'OPENPIX:TRANSACTION_RECEIVED'].includes(event) || ['COMPLETED', 'CONFIRMED'].includes(String(charge?.status ?? ''));
    if (!paid) return { status: 200, body: { ok: true, ignored: event || 'not_paid' } };
    const correlationID = String(charge?.correlationID ?? data?.correlationID ?? '');
    const value = Number(charge?.value ?? data?.pix?.value ?? 0);
    return tx(ctx.db, async (c) => {
      const r = await c.query(
        `UPDATE billing_charges SET status = 'paid', paid_at = now() WHERE correlation_id = $1 AND status <> 'paid' RETURNING org_id, amount_minor, period_days`,
        [correlationID],
      );
      const row = r.rows[0];
      if (!row) {
        const exists = await c.query('SELECT 1 FROM billing_charges WHERE correlation_id = $1', [correlationID]);
        return { status: 200, body: { ok: true, duplicate: !!exists.rowCount, unknown: !exists.rowCount } };
      }
      if (value && BigInt(value) < BigInt(row.amount_minor)) {
        throw new AppError(400, 'amount_mismatch', 'Valor pago menor que o da cobrança');
      }
      await c.query(
        `UPDATE organizations SET plan_status = 'active', plan_started_at = COALESCE(plan_started_at, now()),
                plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(days => $2), updated_at = now()
          WHERE id = $1 AND plan_status <> 'exempt'`,
        [row.org_id, row.period_days ?? PERIOD_DAYS],
      );
      await c.query(`INSERT INTO audit_log(org_id, action, target) VALUES ($1, 'billing.paid', $2)`, [row.org_id, correlationID]);
      // pixel da plataforma: Purchase da assinatura (vai para a fila da Conversions API na mesma transação)
      await trackSubscriptionPurchase(ctx, c, { orgId: row.org_id, amountMinor: row.amount_minor, correlationId: correlationID });
      return { status: 200, body: { ok: true, renewed: true } };
    });
  }

  for (const path of ['/v1/webhooks/woovi', '/api/billing_webhook.php']) {
    app.post(path, async (req, reply) => {
      const out = await wooviWebhook(req);
      return reply.code(out.status).send(out.body);
    });
  }
}
