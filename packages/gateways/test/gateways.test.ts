import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADAPTERS, extractProductIds, idempotencyKey, purchaseEventId, signCheckoutBody, type InboundRequest, type NormalizedPayment } from '../src/index.js';

const opts = { defaultCurrency: 'BRL', now: () => new Date('2026-10-29T12:00:00Z') };
const req = (payload: Record<string, unknown>, extra: Partial<InboundRequest> = {}): InboundRequest => ({
  rawBody: JSON.stringify(payload), headers: {}, query: {}, payload, ...extra,
});
const asPayment = (n: unknown) => {
  expect((n as { kind: string }).kind).toBe('payment');
  return n as NormalizedPayment;
};

describe('Kiwify', () => {
  const paid = {
    order_id: 'K-1', order_status: 'paid', webhook_event_type: 'order_approved',
    Commissions: { charge_amount: 997, currency: 'BRL' },
    Customer: { email: 'Ana@X.com', full_name: 'Ana Lima', mobile: '+5511988887777', CPF: '12345678909' },
    Product: { product_id: 'P1', product_name: 'Ebook' },
    TrackingParameters: { utm_source: 'fb', utm_campaign: 'camp', sck: 'external_id=xid-1&fbp=fb.1.1.2' },
  };
  it('compra paga vira pagamento APROVADO (regressão P-02) com centavos exatos (P-04)', () => {
    const n = asPayment(ADAPTERS.kiwify.normalize(paid, opts));
    expect(n.status).toBe('approved');
    expect(n.amountMinor).toBe(997n); // R$ 9,97 — o legado lia R$ 997
    expect(n.customer.email).toBe('ana@x.com');
    expect(n.tracking).toMatchObject({ utm_source: 'fb', externalId: 'xid-1', fbp: 'fb.1.1.2' });
    expect(purchaseEventId(n)).toBe('K-1');
  });
  it('estados do ciclo de vida', () => {
    expect(asPayment(ADAPTERS.kiwify.normalize({ ...paid, order_status: 'waiting_payment' }, opts)).status).toBe('pending');
    expect(asPayment(ADAPTERS.kiwify.normalize({ ...paid, order_status: 'refunded' }, opts)).status).toBe('refunded');
    expect(asPayment(ADAPTERS.kiwify.normalize({ ...paid, order_status: 'chargedback' }, opts)).status).toBe('chargeback');
    expect(asPayment(ADAPTERS.kiwify.normalize({ ...paid, order_status: 'refused' }, opts)).status).toBe('failed');
    expect(ADAPTERS.kiwify.normalize({ ...paid, order_status: 'xpto' }, opts).kind).toBe('ignored');
  });
  it('assinatura HMAC-SHA1 — válida, inválida, ausente, sem segredo', () => {
    const r = req(paid);
    const sig = createHmac('sha1', 's3cr3t').update(r.rawBody).digest('hex');
    expect(ADAPTERS.kiwify.verify({ ...r, query: { signature: sig } }, 's3cr3t').ok).toBe(true);
    expect(ADAPTERS.kiwify.verify({ ...r, query: { signature: 'deadbeef' } }, 's3cr3t').ok).toBe(false);
    expect(ADAPTERS.kiwify.verify(r, 's3cr3t').reason).toBe('missing_signature');
    expect(ADAPTERS.kiwify.verify(r, null).reason).toBe('secret_not_configured');
  });
});

describe('Cakto', () => {
  const base = { secret: 'abc', event: 'purchase_approved', data: { id: 'C-1', amount: 197.9, status: 'paid', customer: { email: 'a@b.com', name: 'Bia Souza' }, product: { id: 'PX', name: 'Curso' } } };
  it('aprovado em reais', () => {
    const n = asPayment(ADAPTERS.cakto.normalize(base, opts));
    expect([n.status, n.amountMinor, n.customer.firstName]).toEqual(['approved', 19790n, 'Bia']);
  });
  it('pix gerado = pendente; abandono ignorado; secret no JSON', () => {
    expect(asPayment(ADAPTERS.cakto.normalize({ ...base, event: 'pix_gerado' }, opts)).status).toBe('pending');
    expect(ADAPTERS.cakto.normalize({ ...base, event: 'checkout_abandonment' }, opts).kind).toBe('ignored');
    expect(ADAPTERS.cakto.verify(req(base), 'abc').ok).toBe(true);
    expect(ADAPTERS.cakto.verify(req({ ...base, secret: 'x' }), 'abc').ok).toBe(false);
  });
});

describe('Kirvano', () => {
  const sale = { event: 'SALE_APPROVED', sale_id: 'KV-1', total_price: 'R$ 1.297,00', customer: { email: 'c@d.com' }, products: [{ id: 'O1', name: 'Mentoria', price: 'R$ 1.297,00' }] };
  it('aprovado com valor BR formatado', () => {
    const n = asPayment(ADAPTERS.kirvano.normalize(sale, opts));
    expect([n.status, n.amountMinor]).toEqual(['approved', 129700n]);
    expect(n.products[0]?.priceMinor).toBe(129700n);
  });
  it('token no header security-token', () => {
    expect(ADAPTERS.kirvano.verify(req(sale, { headers: { 'security-token': 'tok' } }), 'tok').ok).toBe(true);
    expect(ADAPTERS.kirvano.verify(req(sale, { headers: { 'security-token': 'x' } }), 'tok').ok).toBe(false);
  });
});

describe('Hotmart — validação estrita preservada', () => {
  const approved = (over: Record<string, unknown> = {}) => ({
    id: 'evt-1', event: 'PURCHASE_APPROVED', creation_date: 1761700000000,
    data: {
      buyer: { email: 'e@f.com', name: 'Eva Melo', checkout_phone: '11999990000', address: { city: 'Recife', state: 'PE', country_iso: 'BR' } },
      product: { id: 99, name: 'Curso H' },
      purchase: {
        transaction: 'HP123', status: 'APPROVED', approved_date: 1761739200000,
        price: { value: 297.5, currency_value: 'EUR' },
        origin: { xcod: 'external_id=xid-9&fbp=fb.1.10.20&utm_source=ig&utm_campaign=c1' },
        ...over,
      },
    },
  });
  it('aprovada com xcod → identidade e UTMs', () => {
    const n = asPayment(ADAPTERS.hotmart.normalize(approved(), opts));
    expect([n.status, n.amountMinor, n.currency, n.sourceEventId]).toEqual(['approved', 29750n, 'EUR', 'evt-1']);
    expect(n.tracking).toMatchObject({ externalId: 'xid-9', fbp: 'fb.1.10.20', utm_source: 'ig', utm_campaign: 'c1' });
    expect(purchaseEventId(n)).toBe('hotmart_purchase_HP123');
    expect(idempotencyKey(n)).toBe('evt:evt-1');
  });
  it('Purchase sem status pago / sem data / com data futura é bloqueado', () => {
    expect(ADAPTERS.hotmart.normalize(approved({ status: 'WAITING_PAYMENT' }), opts).kind).toBe('ignored');
    expect(ADAPTERS.hotmart.normalize(approved({ approved_date: 0 }), opts).kind).toBe('ignored');
    expect(ADAPTERS.hotmart.normalize(approved({ approved_date: Date.parse('2027-01-01') }), opts).kind).toBe('ignored');
  });
  it('reembolso, chargeback, cancelamento, boleto', () => {
    const ev = (event: string) => ({ ...approved(), event });
    expect(asPayment(ADAPTERS.hotmart.normalize(ev('PURCHASE_REFUNDED'), opts)).status).toBe('refunded');
    expect(asPayment(ADAPTERS.hotmart.normalize(ev('PURCHASE_CHARGEBACK'), opts)).status).toBe('chargeback');
    expect(asPayment(ADAPTERS.hotmart.normalize(ev('PURCHASE_CANCELED'), opts)).status).toBe('canceled'); // P-09
    expect(asPayment(ADAPTERS.hotmart.normalize(ev('PURCHASE_BILLET_PRINTED'), opts)).status).toBe('pending');
    expect(ADAPTERS.hotmart.normalize(ev('PURCHASE_OUT_OF_SHOPPING_CART'), opts).kind).toBe('ignored');
  });
  it('hottok', () => {
    expect(ADAPTERS.hotmart.verify(req(approved(), { headers: { 'x-hotmart-hottok': 'H' } }), 'H').ok).toBe(true);
    expect(ADAPTERS.hotmart.verify(req(approved()), 'H').ok).toBe(false);
  });
});

describe('Lowify / Wiapay', () => {
  const sale = { event: 'sale.paid', data: { id: 'L-1', amount: 19700, customer: { email: 'g@h.com' } } };
  it('unidade declarada na integração — sem heurística', () => {
    expect(asPayment(ADAPTERS.lowify.normalize(sale, { ...opts, amountUnit: 'minor' })).amountMinor).toBe(19700n);
    expect(asPayment(ADAPTERS.lowify.normalize(sale, { ...opts, amountUnit: 'major' })).amountMinor).toBe(1970000n);
  });
  it('canceled = canceled (não refund, P-09); unpaid = failed (P-03)', () => {
    expect(asPayment(ADAPTERS.wiapay.normalize({ status: 'canceled', id: 'W' }, opts)).status).toBe('canceled');
    expect(asPayment(ADAPTERS.wiapay.normalize({ status: 'unpaid', id: 'W' }, opts)).status).toBe('failed');
  });
  it('segredo configurado passa a ser obrigatório (P-18)', () => {
    const r = req(sale);
    expect(ADAPTERS.lowify.verify(r, null).ok).toBe(true);
    expect(ADAPTERS.lowify.verify(r, 'k').ok).toBe(false);
    const sig = createHmac('sha256', 'k').update(r.rawBody).digest('hex');
    expect(ADAPTERS.lowify.verify({ ...r, headers: { 'x-signature': `sha256=${sig}` } }, 'k').ok).toBe(true);
  });
});

describe('Checkout próprio — formato legado', () => {
  const body = {
    event: 'payment.approved', transaction_id: 'PED-1', value: '197,00', currency: 'EUR', product_id: '9452226',
    customer: { email: 'i@j.com', phone: '+351911111111', name: 'João Pedro Alves' },
    tracking: { fbp: 'fb.1.1.1', fbc: 'fb.1.2.IwAR', external_id: 'xid-c', purchase_event_id: 'purchase_9452226_1761739200_ab' },
  };
  it('aprovado; event_id específico do Purchase; produto para roteamento', () => {
    const n = asPayment(ADAPTERS.checkout.normalize(body, opts));
    expect([n.status, n.amountMinor, n.currency]).toEqual(['approved', 19700n, 'EUR']);
    expect(n.customer).toMatchObject({ firstName: 'João', lastName: 'Pedro Alves', externalId: 'xid-c' });
    expect(purchaseEventId(n)).toBe('purchase_9452226_1761739200_ab');
    expect(extractProductIds(body)).toEqual(['9452226']);
  });
  it('"purchase" sozinho não confirma pagamento; pendente vira pending; status negativo vence', () => {
    expect(ADAPTERS.checkout.normalize({ ...body, event: 'purchase' }, opts)).toMatchObject({ kind: 'ignored', reason: 'purchase_without_payment_confirmation' });
    expect(asPayment(ADAPTERS.checkout.normalize({ ...body, event: 'pix_generated' }, opts)).status).toBe('pending');
    expect(asPayment(ADAPTERS.checkout.normalize({ ...body, event: 'purchase', status: 'unpaid' }, opts)).status).toBe('failed');
    expect(asPayment(ADAPTERS.checkout.normalize({ ...body, event: 'purchase', payment: { status: 'paid' } }, opts)).status).toBe('approved');
  });
  it('Purchase sem valor positivo é ignorado; aliases data/payer', () => {
    expect(ADAPTERS.checkout.normalize({ ...body, value: 0 }, opts).kind).toBe('ignored');
    const n = asPayment(ADAPTERS.checkout.normalize({ data: { event: 'paid', txid: 'T9', amount: 50, payer: { email: 'k@l.com' } } }, opts));
    expect([n.transactionId, n.amountMinor, n.customer.email]).toEqual(['T9', 5000n, 'k@l.com']);
  });
  it('Lead é evento de servidor, não pagamento', () => {
    expect(ADAPTERS.checkout.normalize({ event: 'lead', email: 'm@n.com' }, opts).kind).toBe('event');
  });
  it('HMAC obrigatório quando configurado (P-10) e janela anti-replay', () => {
    const r = req(body);
    expect(ADAPTERS.checkout.verify(r, null).ok).toBe(true);
    expect(ADAPTERS.checkout.verify(r, 'sec').reason).toBe('missing_signature');
    expect(ADAPTERS.checkout.verify({ ...r, headers: { 'x-paytrack-signature': signCheckoutBody(r.rawBody, 'sec') } }, 'sec').ok).toBe(true);
    const ts = String(Math.floor(Date.now() / 1000));
    expect(ADAPTERS.checkout.verify({ ...r, headers: { 'x-paytrack-signature': signCheckoutBody(r.rawBody, 'sec', ts), 'x-paytrack-timestamp': ts } }, 'sec').ok).toBe(true);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(ADAPTERS.checkout.verify({ ...r, headers: { 'x-paytrack-signature': signCheckoutBody(r.rawBody, 'sec', old), 'x-paytrack-timestamp': old } }, 'sec').reason).toBe('timestamp_out_of_window');
  });
});
