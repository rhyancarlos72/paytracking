import { cakto } from './adapters/cakto.js';
import { checkout } from './adapters/checkout.js';
import { lowify, wiapay } from './adapters/generic.js';
import { hotmart } from './adapters/hotmart.js';
import { kirvano } from './adapters/kirvano.js';
import { kiwify } from './adapters/kiwify.js';
import type { GatewayAdapter, NormalizedPayment, Provider } from './types.js';

export * from './types.js';
export { extractProductIds, signCheckoutBody } from './adapters/checkout.js';
export { safeEqual } from './util.js';

export const ADAPTERS: Record<Provider, GatewayAdapter> = { checkout, kiwify, cakto, kirvano, hotmart, lowify, wiapay };

export function getAdapter(provider: string): GatewayAdapter | null {
  return (ADAPTERS as Record<string, GatewayAdapter>)[provider] ?? null;
}

/**
 * Chave de idempotência do webhook: id do evento do gateway quando existe; senão
 * (transação + status), já que a máquina de estados torna o reprocessamento seguro.
 */
export function idempotencyKey(n: NormalizedPayment): string {
  return n.sourceEventId ? `evt:${n.sourceEventId}` : `txn:${n.transactionId}:${n.status}`;
}

/**
 * event_id do Purchase — estável por transação (dedup na Meta). Mantém as regras do
 * legado para não quebrar a deduplicação com Purchases de navegador já existentes:
 *  1) purchase_event_id encaminhado pelo checkout/pixel;
 *  2) Hotmart: "hotmart_purchase_<transação>";
 *  3) demais: o próprio transaction_id.
 */
export function purchaseEventId(n: NormalizedPayment): string {
  const forwarded = n.tracking.purchaseEventId?.trim();
  if (forwarded && forwarded.length <= 128) return forwarded;
  if (n.provider === 'hotmart') return `hotmart_purchase_${n.transactionId}`;
  return n.transactionId;
}

export function refundEventId(n: NormalizedPayment): string {
  return `refund_${n.provider}_${n.transactionId}`;
}
