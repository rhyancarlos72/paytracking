/**
 * Status de pagamento canônico + máquina de estados (ADR-006).
 *
 * Corrige P-03: a classificação é por CORRESPONDÊNCIA EXATA de tokens, nunca por
 * substring ("unpaid", "not_paid", "disapproved" eram lidos como pagos no legado).
 */

export const PAYMENT_STATUSES = ['pending', 'approved', 'refunded', 'chargeback', 'canceled', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function statusToken(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const GENERIC: Record<string, PaymentStatus> = {};
const put = (s: PaymentStatus, tokens: string[]) => tokens.forEach((t) => (GENERIC[t] = s));

put('approved', [
  'paid', 'pago', 'approved', 'aprovado', 'aprovada', 'complete', 'completed', 'captured', 'settled',
  'confirmed', 'confirmado', 'succeeded', 'success', 'successful', 'concluido', 'liquidado', 'liquidated',
  'authorized_and_captured', 'payment_approved', 'payment_paid', 'payment_completed', 'sale_approved',
  'sale_paid', 'order_paid', 'order_approved', 'order_completed', 'purchase_approved', 'purchase_paid',
  'pix_paid', 'charge_completed',
]);
put('pending', [
  'pending', 'pendente', 'waiting', 'waiting_payment', 'aguardando', 'aguardando_pagamento', 'created',
  'generated', 'pix_generated', 'pix_created', 'pix_gerado', 'pix_pending', 'open', 'em_aberto', 'aberto',
  'processing', 'em_processamento', 'analise', 'em_analise', 'in_analysis', 'waiting_payment_confirmation',
  'billet_printed', 'printed_billet', 'boleto_gerado', 'sale_pending', 'payment_pending', 'started',
]);
put('refunded', ['refunded', 'reembolsado', 'reembolso', 'estornado', 'refund', 'sale_refunded', 'payment_refunded', 'order_refunded']);
put('chargeback', ['chargeback', 'chargedback', 'charged_back', 'dispute', 'disputed', 'contestado']);
put('canceled', ['canceled', 'cancelled', 'cancelado', 'cancelada', 'expired', 'expirado', 'voided', 'void', 'sale_canceled']);
put('failed', ['refused', 'recusado', 'recusada', 'declined', 'failed', 'falhou', 'denied', 'rejected', 'unpaid', 'not_paid', 'disapproved']);

/** Classificação genérica (checkout próprio). Retorna undefined para token desconhecido. */
export function classifyGenericStatus(raw: unknown): PaymentStatus | undefined {
  const t = statusToken(raw);
  return t ? GENERIC[t] : undefined;
}

/** Eventos sem campo de status que, sozinhos, confirmam pagamento (legado: explicitPaidEvents). */
const EXPLICIT_EVENTS: Record<string, PaymentStatus> = {
  paid: 'approved', payment_paid: 'approved', payment_approved: 'approved', payment_completed: 'approved',
  sale_approved: 'approved', sale_paid: 'approved', purchase_approved: 'approved', purchase_paid: 'approved',
  order_paid: 'approved', order_completed: 'approved', approved: 'approved', completed: 'approved',
  complete: 'approved', captured: 'approved', settled: 'approved', pix_paid: 'approved',
  refund: 'refunded', refunded: 'refunded', sale_refunded: 'refunded', reembolso: 'refunded', estornado: 'refunded',
  chargeback: 'chargeback',
  pix_generated: 'pending', pix_created: 'pending', pix_gerado: 'pending', pending: 'pending',
  sale_pending: 'pending', waiting_payment: 'pending', aguardando_pagamento: 'pending',
  canceled: 'canceled', cancelled: 'canceled', expired: 'canceled',
};

export function classifyByEventName(raw: unknown): PaymentStatus | undefined {
  return EXPLICIT_EVENTS[statusToken(raw)];
}

/**
 * Resolve o status a partir de vários campos de status do payload. Regra conservadora
 * (herdada do legado: "qualquer sinal de não-pagamento vence"):
 * refunded/chargeback > canceled/failed > pending > approved. Desconhecidos são ignorados,
 * mas se TODOS forem desconhecidos o resultado é 'unknown'.
 */
export function resolveStatus(values: unknown[]): PaymentStatus | 'unknown' | 'none' {
  const present = values.filter((v) => statusToken(v) !== '');
  if (present.length === 0) return 'none';
  const classes = present.map(classifyGenericStatus).filter((s): s is PaymentStatus => !!s);
  if (classes.length === 0) return 'unknown';
  const order: PaymentStatus[] = ['refunded', 'chargeback', 'canceled', 'failed', 'pending', 'approved'];
  for (const s of order) if (classes.includes(s)) return s;
  return 'unknown';
}

const RANK: Record<PaymentStatus, number> = {
  pending: 0, failed: 1, canceled: 1, approved: 2, refunded: 3, chargeback: 3,
};

/**
 * Transições aceitas. Eventos fora de ordem (ex.: "pending" depois de "approved")
 * são ignorados em vez de regredir o estado.
 */
export function canTransition(from: PaymentStatus | null, to: PaymentStatus): boolean {
  if (from === null) return true;
  if (from === to) return false;
  if ((from === 'failed' || from === 'canceled') && to === 'approved') return true;
  if (from === 'pending' && (to === 'failed' || to === 'canceled')) return true;
  if ((from === 'refunded' && to === 'chargeback') || (from === 'chargeback' && to === 'refunded')) return false;
  return RANK[to] > RANK[from];
}

/** Uma transição que deve gerar Purchase na Meta (uma única vez por transação). */
export function isPurchaseTransition(from: PaymentStatus | null, to: PaymentStatus): boolean {
  return to === 'approved' && from !== 'approved' && from !== 'refunded' && from !== 'chargeback';
}

export function isReversal(to: PaymentStatus): boolean {
  return to === 'refunded' || to === 'chargeback';
}
