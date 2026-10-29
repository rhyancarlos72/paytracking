import { statusToken, type PaymentStatus } from '@pt/domain';
import type { GatewayAdapter } from '../types.js';
import { amount, currencyOr, customerFrom, hmacHex, obj, pick, product, safeEqual, toDate, trackingFrom } from '../util.js';

/**
 * Kiwify — assinatura HMAC-SHA1 (hex) do corpo cru com o token do webhook,
 * enviada em ?signature=. Valores de Commissions.* em CENTAVOS.
 */
const STATUS: Record<string, PaymentStatus> = {
  paid: 'approved', approved: 'approved', order_approved: 'approved',
  waiting_payment: 'pending', pix_created: 'pending', billet_created: 'pending',
  refused: 'failed', order_rejected: 'failed',
  refunded: 'refunded', order_refunded: 'refunded',
  chargedback: 'chargeback', chargeback: 'chargeback',
  canceled: 'canceled', cancelled: 'canceled',
};

export const kiwify: GatewayAdapter = {
  provider: 'kiwify',
  label: 'Kiwify',
  authMethod: 'HMAC-SHA1 do corpo em ?signature=',
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: 'hmac_sha1', reason: 'secret_not_configured' };
    const provided = (req.query.signature ?? req.headers['x-kiwify-signature'] ?? '').trim().toLowerCase();
    if (!provided) return { ok: false, method: 'hmac_sha1', reason: 'missing_signature' };
    return { ok: safeEqual(hmacHex('sha1', req.rawBody, secret), provided), method: 'hmac_sha1', reason: 'signature_mismatch' };
  },
  isTestPing: (req) => !req.payload.order_id && !req.payload.order_status,
  normalize(p, opts) {
    const gatewayEvent = String(p.order_status ?? p.webhook_event_type ?? '');
    // order_status é autoritativo; o tipo do evento só é usado quando o status não vem.
    const status = statusToken(p.order_status) ? STATUS[statusToken(p.order_status)] : STATUS[statusToken(p.webhook_event_type)];
    const transactionId = pick(p, ['order_id', 'order_ref', 'id']);
    if (!transactionId) return { kind: 'ignored', provider: 'kiwify', reason: 'missing_transaction_id', gatewayEvent };
    if (!status) return { kind: 'ignored', provider: 'kiwify', reason: 'unknown_status', gatewayEvent, transactionId };
    const comm = obj(p.Commissions);
    const currency = currencyOr(comm.currency ?? p.currency, opts.defaultCurrency);
    const value = amount(comm.charge_amount ?? p.charge_amount ?? comm.product_base_price, currency, 'minor');
    const prod = obj(p.Product);
    const tp = obj(p.TrackingParameters);
    return {
      kind: 'payment', provider: 'kiwify', sourceEventId: null, transactionId, status, gatewayEvent,
      amountMinor: value, currency,
      occurredAt: toDate(p.approved_date ?? p.updated_at ?? p.created_at),
      customer: customerFrom(obj(p.Customer ?? p.customer)),
      products: Object.keys(prod).length ? [product(prod, currency, 'minor', value)] : [],
      tracking: { ...trackingFrom(tp, typeof tp.sck === 'string' ? tp.sck : null), ...(tp.sck ? { sck: String(tp.sck) } : {}) },
    };
  },
};
