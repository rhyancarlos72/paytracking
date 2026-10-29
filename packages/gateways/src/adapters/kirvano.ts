import { classifyGenericStatus, statusToken, type PaymentStatus } from '@pt/domain';
import type { GatewayAdapter } from '../types.js';
import { amount, currencyOr, customerFrom, obj, pick, pickRaw, product, safeEqual, toDate, trackingFrom } from '../util.js';

/** Kirvano — token estático no header `security-token`. Valores em REAIS ("R$ 197,00"). */
const EVENTS: Record<string, PaymentStatus | 'ignore'> = {
  sale_approved: 'approved', payment_approved: 'approved',
  sale_refused: 'failed',
  sale_refunded: 'refunded', refund: 'refunded',
  sale_chargeback: 'chargeback', chargeback: 'chargeback',
  sale_pending: 'pending', pix_generated: 'pending', bank_slip_generated: 'pending', picpay_generated: 'pending',
  sale_canceled: 'canceled', pix_expired: 'canceled', bank_slip_expired: 'canceled',
  abandoned_cart: 'ignore',
};

export const kirvano: GatewayAdapter = {
  provider: 'kirvano',
  label: 'Kirvano',
  authMethod: 'header security-token',
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: 'static_token', reason: 'secret_not_configured' };
    const provided = (req.headers['security-token'] ?? req.headers['x-kirvano-token'] ?? req.headers.token ?? '').trim();
    if (!provided) return { ok: false, method: 'static_token', reason: 'missing_token_header' };
    return { ok: safeEqual(secret, provided), method: 'static_token', reason: 'token_mismatch' };
  },
  isTestPing: (req) => !req.payload.event && !req.payload.sale_id,
  normalize(p, opts) {
    const gatewayEvent = String(p.event ?? p.status ?? '');
    const mapped = EVENTS[statusToken(p.event)];
    if (mapped === 'ignore') return { kind: 'ignored', provider: 'kirvano', reason: 'not_a_payment_event', gatewayEvent };
    const status = mapped ?? classifyGenericStatus(p.status);
    const transactionId = pick(p, ['sale_id', 'transaction_id', 'order_id', 'checkout_id', 'id']);
    if (!transactionId) return { kind: 'ignored', provider: 'kirvano', reason: 'missing_transaction_id', gatewayEvent };
    if (!status) return { kind: 'ignored', provider: 'kirvano', reason: 'unknown_status', gatewayEvent, transactionId };
    const currency = currencyOr(p.currency, opts.defaultCurrency);
    const value = amount(pickRaw(p, ['total_price', 'value', 'amount']), currency, 'major');
    const products = Array.isArray(p.products) ? p.products.map((x) => product(obj(x), currency, 'major')) : [];
    return {
      kind: 'payment', provider: 'kirvano', sourceEventId: null, transactionId, status, gatewayEvent,
      amountMinor: value, currency,
      occurredAt: toDate(p.created_at),
      customer: customerFrom(obj(p.customer)),
      products,
      tracking: trackingFrom(obj(p.utm), obj(p.tracking)),
    };
  },
};
