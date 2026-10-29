/**
 * Nomes de evento. Preserva o mapeamento tolerante do legado (MetaCapi::mapEventName),
 * que aceita variações enviadas por checkouts ("purshase", "pix_gerado", ...).
 */

export const META_EVENTS = [
  'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Lead', 'Purchase', 'Refund',
] as const;
export type MetaEventName = (typeof META_EVENTS)[number];

/** Eventos que o NAVEGADOR pode enviar (Purchase e Refund só pelo servidor — corrige P-11). */
export const BROWSER_EVENTS: readonly MetaEventName[] = [
  'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Lead',
];

/** Eventos que carregam value/currency na Meta (igual ao legado). PageView nunca leva valor. */
export const VALUE_EVENTS: readonly MetaEventName[] = [
  'Purchase', 'InitiateCheckout', 'AddToCart', 'ViewContent', 'AddPaymentInfo',
];

export function normalizeEventKey(event: string): string {
  return event.trim().toLowerCase().replace(/[-\s:]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const MAP: Record<string, MetaEventName> = {};
const add = (name: MetaEventName, keys: string[]) => keys.forEach((k) => (MAP[k] = name));

add('Purchase', [
  'purchase', 'purshase', 'comprou', 'compra', 'approved', 'aprovado', 'paid', 'pago',
  'sale.approved', 'sale_approved', 'sale_paid', 'payment.approved', 'payment_approved',
  'payment.paid', 'payment_paid', 'pix_paid', 'pix.paid', 'order_paid', 'order.paid',
  'order_approved', 'order.approved', 'checkout.purchase', 'checkout_purchase',
]);
add('InitiateCheckout', [
  'sale.pending', 'sale_pending', 'checkout', 'initiatecheckout', 'initiate_checkout',
  'checkout_started', 'checkout.started', 'pix_generated', 'pix.generated', 'pix_gerado',
  'pix.gerado', 'pix.created', 'pix_created', 'pix.pending', 'pix_pending', 'pending',
  'pendente', 'waiting_payment', 'aguardando_pagamento', 'aguardando_pagamento_pix',
]);
add('Lead', ['lead', 'generatelead', 'generate_lead', 'cadastro', 'signup', 'sign_up']);
add('Refund', ['sale.refunded', 'sale_refunded', 'refund', 'refunded', 'reembolso', 'estornado']);
add('PageView', ['page_view', 'pageview', 'page.view', 'page_viewed']);
add('AddToCart', ['add_to_cart', 'addtocart', 'cart', 'adicionar_carrinho']);
add('ViewContent', ['view_content', 'viewcontent', 'content_view', 'produto_visualizado']);
add('AddPaymentInfo', ['add_payment_info', 'addpaymentinfo']);

export function mapEventName(raw: string): MetaEventName | null {
  if (!raw) return null;
  const key = normalizeEventKey(raw);
  // o legado normalizava '.' só via match direto; aceitamos as duas formas
  return MAP[key] ?? MAP[raw.trim().toLowerCase()] ?? MAP[key.replace(/\./g, '_')] ?? null;
}
