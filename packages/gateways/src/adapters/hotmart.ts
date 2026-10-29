import { statusToken, type PaymentStatus } from '@pt/domain';
import type { GatewayAdapter, Normalized } from '../types.js';
import { amount, currencyOr, customerFrom, obj, pick, safeEqual, toDate, trackingFrom } from '../util.js';

/**
 * Hotmart Webhook 2.0 — token estático "Hottok" em X-HOTMART-HOTTOK.
 * Preserva a validação ESTRITA do legado para compra aprovada: evento de compra +
 * status pago + approved_date válida + transação + e-mail do comprador + produto.
 * Valores em REAIS (purchase.price.value).
 */
const EVENTS: Record<string, PaymentStatus | 'ignore'> = {
  purchase_approved: 'approved', purchase_complete: 'approved',
  purchase_refunded: 'refunded',
  purchase_chargeback: 'chargeback', purchase_protest: 'chargeback',
  purchase_canceled: 'canceled', purchase_expired: 'canceled',
  purchase_billet_printed: 'pending', purchase_delayed: 'pending',
  purchase_out_of_shopping_cart: 'ignore',
};
const PAID = new Set(['approved', 'complete', 'completed']);

export const hotmart: GatewayAdapter = {
  provider: 'hotmart',
  label: 'Hotmart',
  authMethod: 'header X-HOTMART-HOTTOK',
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: 'hottok', reason: 'secret_not_configured' };
    const provided = (req.headers['x-hotmart-hottok'] ?? req.headers.hottok ?? pick(req.payload, ['hottok']) ?? '').trim();
    if (!provided) return { ok: false, method: 'hottok', reason: 'missing_hottok' };
    return { ok: safeEqual(secret, provided), method: 'hottok', reason: 'hottok_mismatch' };
  },
  isTestPing: () => false,
  normalize(p, opts): Normalized {
    const data = obj(p.data);
    const purchase = obj(data.purchase);
    const event = String(p.event ?? data.event ?? '');
    const evKey = statusToken(event);
    const mapped = EVENTS[evKey];
    const gatewayEvent = event;
    const transactionId = pick(purchase, ['transaction', 'order_id', 'id']);
    if (mapped === 'ignore') return { kind: 'ignored', provider: 'hotmart', reason: 'not_a_payment_event', gatewayEvent };
    if (!mapped) return { kind: 'ignored', provider: 'hotmart', reason: 'unknown_event', gatewayEvent };
    if (!transactionId) return { kind: 'ignored', provider: 'hotmart', reason: 'missing_transaction_id', gatewayEvent };

    const purchaseStatus = statusToken(purchase.status);
    const approvedMs = Number(purchase.approved_date ?? 0);
    const now = (opts.now?.() ?? new Date()).getTime();
    if (mapped === 'approved') {
      const buyerEmail = pick(obj(data.buyer), ['email']);
      const productId = pick(obj(data.product), ['id', 'ucode']);
      const valid =
        PAID.has(purchaseStatus) &&
        approvedMs > 0 && approvedMs <= now + 300_000 &&
        !!buyerEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail) &&
        !!productId;
      if (!valid) {
        return { kind: 'ignored', provider: 'hotmart', reason: 'hotmart_purchase_failed_strict_validation', gatewayEvent, transactionId };
      }
    }

    const price = obj(purchase.price);
    const full = obj(purchase.full_price);
    const currency = currencyOr(price.currency_value ?? price.currency_code ?? full.currency_value, opts.defaultCurrency);
    const value = amount(price.value ?? full.value ?? obj(purchase.original_offer_price).value, currency, 'major');
    const prod = obj(data.product);
    const origin = obj(purchase.origin);
    const xcod = pick(origin, ['xcod']) ?? pick(purchase, ['xcod']) ?? pick(data, ['xcod']);
    const sck = pick(purchase, ['sckPaymentLink']) ?? pick(origin, ['sck']) ?? pick(purchase, ['sck']) ?? pick(data, ['sck']);
    const tracking = trackingFrom(obj(data.tracking), obj(purchase.tracking), xcod, origin, sck);
    if (xcod) tracking.xcod = xcod;
    if (sck) tracking.sck = sck;
    if (typeof p.purchase_event_id === 'string' && p.purchase_event_id) tracking.purchaseEventId = p.purchase_event_id;

    return {
      kind: 'payment', provider: 'hotmart',
      sourceEventId: pick(p, ['id', 'event_id', 'webhook_id']),
      transactionId, status: mapped, gatewayEvent,
      amountMinor: value, currency,
      occurredAt: mapped === 'approved' ? toDate(approvedMs) : toDate(p.creation_date),
      customer: customerFrom(obj(data.buyer)),
      products: Object.keys(prod).length
        ? [{ id: pick(prod, ['id', 'ucode']), name: pick(prod, ['name']), quantity: 1, priceMinor: value }]
        : [],
      tracking,
    };
  },
};
