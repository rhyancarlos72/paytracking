import { classifyGenericStatus, statusToken } from '@pt/domain';
import type { GatewayAdapter, Provider } from '../types.js';
import { amount, currencyOr, customerFrom, hmacHex, obj, pick, pickRaw, product, safeEqual, toDate, trackingFrom } from '../util.js';

/**
 * Lowify e Wiapay não publicam esquema de assinatura. Autenticação principal:
 * segredo no caminho da URL do webhook. Se o usuário configurar um segredo, ele passa
 * a ser OBRIGATÓRIO (HMAC-SHA256 hex do corpo ou token estático) — no legado uma
 * assinatura inválida era aceita (P-18).
 * A unidade do valor é configurável na integração (padrão: reais) — sem heurística.
 */
function makeGeneric(provider: Provider, label: string): GatewayAdapter {
  return {
    provider,
    label,
    authMethod: 'segredo na URL (+ HMAC-SHA256 ou token opcional)',
    requiresSecret: false,
    configurableAmountUnit: true,
    verify(req, secret) {
      if (!secret) return { ok: true, method: 'url_token_only' };
      let provided = (
        req.headers['x-signature'] ?? req.headers['x-webhook-signature'] ?? req.headers['x-hub-signature-256'] ??
        req.query.signature ?? pick(req.payload, ['signature', 'secret']) ?? ''
      ).trim();
      if (!provided) return { ok: false, method: 'hmac_sha256', reason: 'missing_signature' };
      if (/^sha256=/i.test(provided)) provided = provided.slice(7);
      if (safeEqual(hmacHex('sha256', req.rawBody, secret), provided.toLowerCase())) return { ok: true, method: 'hmac_sha256' };
      if (safeEqual(secret, provided)) return { ok: true, method: 'static_token' };
      return { ok: false, method: 'hmac_sha256', reason: 'signature_mismatch' };
    },
    isTestPing: (req) => ['test', 'ping', 'webhook_test'].includes(statusToken(req.payload.event ?? req.payload.type)),
    normalize(p, opts) {
      const data = Object.keys(obj(p.data)).length ? obj(p.data) : p;
      const rawStatus = String(p.event ?? data.event ?? data.status ?? data.payment_status ?? '');
      const token = statusToken(rawStatus).replace(/^(sale|payment|order)_/, '');
      const status = classifyGenericStatus(token) ?? classifyGenericStatus(data.status);
      const transactionId = pick(data, ['sale_id', 'saleId', 'transaction_id', 'transactionId', 'order_id', 'orderId', 'id', 'reference', 'checkout_id']);
      if (!transactionId) return { kind: 'ignored', provider, reason: 'missing_transaction_id', gatewayEvent: rawStatus };
      if (!status) return { kind: 'ignored', provider, reason: 'unknown_status', gatewayEvent: rawStatus, transactionId };
      const unit = opts.amountUnit ?? 'major';
      const currency = currencyOr(data.currency, opts.defaultCurrency);
      const value = amount(pickRaw(data, ['amount', 'value', 'total', 'total_price', 'price']), currency, unit);
      const customer = obj(data.customer ?? data.buyer ?? data.client);
      const prods = Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : data.product ? [data.product] : [];
      const utm = obj(data.utm ?? data.tracking ?? p.tracking);
      return {
        kind: 'payment', provider, sourceEventId: pick(p, ['event_id', 'webhook_id']), transactionId, status,
        gatewayEvent: rawStatus, amountMinor: value, currency,
        occurredAt: toDate(data.paid_at ?? data.updated_at ?? data.created_at),
        customer: customerFrom(customer),
        products: prods.map((x) => product(obj(x), currency, unit)),
        tracking: trackingFrom(utm),
      };
    },
  };
}

export const lowify = makeGeneric('lowify', 'Lowify');
export const wiapay = makeGeneric('wiapay', 'Wiapay');
