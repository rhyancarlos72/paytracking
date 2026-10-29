import { classifyGenericStatus, statusToken, type PaymentStatus } from '@pt/domain';
import type { GatewayAdapter } from '../types.js';
import { amount, currencyOr, customerFrom, obj, pick, pickRaw, product, safeEqual, toDate, trackingFrom } from '../util.js';

/** Cakto — o segredo vem no campo `secret` do próprio JSON. Valores em REAIS. */
const EVENTS: Record<string, PaymentStatus | 'ignore'> = {
  purchase_approved: 'approved', purchase_completed: 'approved',
  purchase_refused: 'failed',
  refund: 'refunded', refunded: 'refunded',
  chargeback: 'chargeback',
  pix_gerado: 'pending', boleto_gerado: 'pending', picpay_gerado: 'pending', purchase_pending: 'pending',
  checkout_abandonment: 'ignore',
};

export const cakto: GatewayAdapter = {
  provider: 'cakto',
  label: 'Cakto',
  authMethod: 'campo "secret" no corpo JSON',
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: 'payload_secret', reason: 'secret_not_configured' };
    const provided = pick(req.payload, ['secret', 'data.secret']);
    if (!provided) return { ok: false, method: 'payload_secret', reason: 'missing_secret_field' };
    return { ok: safeEqual(secret, provided), method: 'payload_secret', reason: 'secret_mismatch' };
  },
  isTestPing: (req) => statusToken(req.payload.event) === 'test',
  normalize(p, opts) {
    const data = Object.keys(obj(p.data)).length ? obj(p.data) : p;
    const gatewayEvent = String(p.event ?? data.status ?? '');
    const mapped = EVENTS[statusToken(p.event)];
    if (mapped === 'ignore') return { kind: 'ignored', provider: 'cakto', reason: 'not_a_payment_event', gatewayEvent };
    const status = mapped ?? classifyGenericStatus(data.status);
    const transactionId = pick(data, ['id', 'transaction_id', 'transactionId', 'order_id', 'refId']);
    if (!transactionId) return { kind: 'ignored', provider: 'cakto', reason: 'missing_transaction_id', gatewayEvent };
    if (!status) return { kind: 'ignored', provider: 'cakto', reason: 'unknown_status', gatewayEvent, transactionId };
    const currency = currencyOr(data.currency, opts.defaultCurrency);
    const value = amount(pickRaw(data, ['amount', 'value', 'total', 'baseAmount']), currency, 'major');
    const prod = obj(data.product);
    return {
      kind: 'payment', provider: 'cakto', sourceEventId: null, transactionId, status, gatewayEvent,
      amountMinor: value, currency,
      occurredAt: toDate(data.paidAt ?? data.paid_at ?? data.createdAt),
      customer: customerFrom(obj(data.customer)),
      products: Object.keys(prod).length ? [product(prod, currency, 'major', value)] : [],
      tracking: trackingFrom(obj(data.utm), obj(data.tracking), data, typeof data.sck === 'string' ? data.sck : null),
    };
  },
};
