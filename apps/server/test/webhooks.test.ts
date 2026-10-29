import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatchBatch } from '../src/capi/dispatcher.js';
import { API_URL, json, metaOk, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(() => env.fake.reset());

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  env.app.inject({ method: 'POST', url: url.replace(API_URL, ''), payload: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

const kiwify = (status: string, over: Record<string, unknown> = {}) => ({
  order_id: 'K-100', order_status: status, webhook_event_type: 'order_approved',
  Commissions: { charge_amount: 19700, currency: 'BRL' },
  Customer: { email: 'comprador@x.com', full_name: 'Carla Dias', mobile: '+5511988887777' },
  Product: { product_id: 'PROD-1', product_name: 'Curso' },
  TrackingParameters: { utm_source: 'facebook', utm_campaign: 'Campanha A', sck: 'external_id=xid-777' },
  ...over,
});
const signKiwify = (raw: string, secret: string) => createHmac('sha1', secret).update(raw).digest('hex');

async function kiwifySetup() {
  const acc = await newAccount(env);
  const pixel = await newPixel(acc.client, { productIds: ['PROD-1'] });
  const integ = await newIntegration(acc.client, 'kiwify', { secret: 'kiwi-secret' });
  const send = (body: object, secret = 'kiwi-secret') => {
    const raw = JSON.stringify(body);
    return post(`${integ.webhookUrl}?signature=${signKiwify(raw, secret)}`, raw);
  };
  return { acc, pixel, integ, send };
}

describe('cenários 3/5/6/7 — webhook válido, duplicado, pendente e aprovado', () => {
  it('pendente NÃO gera Purchase; aprovado gera exatamente um Purchase com valor exato', async () => {
    const { acc, send } = await kiwifySetup();

    const pend = await send(kiwify('waiting_payment'));
    expect(pend.statusCode).toBe(200);
    expect(pend.json()).toMatchObject({ processed: true, status: 'pending', queued: false });
    expect((await env.db.query('SELECT count(*)::int n FROM capi_outbox')).rows[0].n).toBe(0);

    const paid = await send(kiwify('paid'));
    expect(paid.json()).toMatchObject({ processed: true, status: 'approved', previousStatus: 'pending', queued: true, eventName: 'Purchase' });

    const out = await env.db.query(`SELECT event_name, event_id, payload FROM capi_outbox WHERE org_id = $1`, [acc.orgId]);
    expect(out.rowCount).toBe(1);
    const ev = out.rows[0].payload;
    expect(ev).toMatchObject({ event_name: 'Purchase', event_id: 'K-100', action_source: 'website' });
    expect(ev.custom_data).toMatchObject({ value: 197, currency: 'BRL', order_id: 'K-100', utm_campaign: 'Campanha A' });
    expect(ev.user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ev.user_data.client_ip_address).toBeUndefined(); // IP do gateway nunca vai para a Meta

    const pay = await env.db.query('SELECT status, amount_minor, currency, approved_at FROM payments WHERE org_id = $1', [acc.orgId]);
    expect(pay.rows[0]).toMatchObject({ status: 'approved', amount_minor: 19700n, currency: 'BRL' });
  });

  it('webhook repetido não gera segunda venda nem segundo envio', async () => {
    const { acc, send } = await kiwifySetup();
    const first = await send(kiwify('paid'));
    const again = await send(kiwify('paid'));
    expect(first.json().processed).toBe(true);
    expect(again.json()).toMatchObject({ duplicate: true });
    const n = await env.db.query(`SELECT (SELECT count(*) FROM payments WHERE org_id = $1)::int p, (SELECT count(*) FROM capi_outbox WHERE org_id = $1)::int o`, [acc.orgId]);
    expect(n.rows[0]).toEqual({ p: 1, o: 1 });
  });

  it('cenário 18 — webhooks idênticos simultâneos produzem 1 pagamento e 1 Purchase', async () => {
    const { acc, send } = await kiwifySetup();
    const results = await Promise.all(Array.from({ length: 8 }, () => send(kiwify('paid'))));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.filter((r) => r.json().processed).length).toBe(1);
    const n = await env.db.query(`SELECT (SELECT count(*) FROM payments WHERE org_id = $1)::int p, (SELECT count(*) FROM capi_outbox WHERE org_id = $1)::int o`, [acc.orgId]);
    expect(n.rows[0]).toEqual({ p: 1, o: 1 });
  });

  it('evento fora de ordem (pending depois de approved) não regride o status', async () => {
    const { acc, send } = await kiwifySetup();
    await send(kiwify('paid'));
    const late = await send(kiwify('waiting_payment'));
    expect(late.json()).toMatchObject({ duplicate: true, status: 'approved' });
    const p = await env.db.query('SELECT status FROM payments WHERE org_id = $1', [acc.orgId]);
    expect(p.rows[0].status).toBe('approved');
  });
});

describe('cenário 4 — webhooks inválidos', () => {
  it('assinatura inválida → 401 e recibo "rejected"; nada é gravado', async () => {
    const { acc, send } = await kiwifySetup();
    const r = await send(kiwify('paid'), 'segredo-errado');
    expect(r.statusCode).toBe(401);
    const w = await env.db.query(`SELECT outcome, reason FROM webhook_receipts WHERE org_id = $1`, [acc.orgId]);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', reason: 'signature_mismatch' });
    expect((await env.db.query('SELECT count(*)::int n FROM payments WHERE org_id = $1', [acc.orgId])).rows[0].n).toBe(0);
  });
  it('token desconhecido → 401; corpo vazio → 200 ping; status desconhecido → ignorado', async () => {
    const { integ, send } = await kiwifySetup();
    expect((await post(`${API_URL}/v1/webhooks/kiwify/itk_invalido`, kiwify('paid'))).statusCode).toBe(401);
    expect((await post(integ.webhookUrl, '')).json()).toMatchObject({ ping: true });
    expect((await send(kiwify('xpto'))).json()).toMatchObject({ ignored: true, reason: 'unknown_status' });
  });
});

describe('cenário 8 — reembolso e cancelamento', () => {
  it('reembolso abate a venda e envia o evento Refund (comportamento legado preservado)', async () => {
    const { acc, send } = await kiwifySetup();
    await send(kiwify('paid'));
    const r = await send(kiwify('refunded'));
    expect(r.json()).toMatchObject({ status: 'refunded', previousStatus: 'approved', queued: true, eventName: 'Refund' });
    const p = await env.db.query('SELECT status, reversed_at FROM payments WHERE org_id = $1', [acc.orgId]);
    expect(p.rows[0].status).toBe('refunded');
    expect(p.rows[0].reversed_at).not.toBeNull();
    const ev = await env.db.query(`SELECT event_name, payload FROM capi_outbox WHERE org_id = $1 ORDER BY id`, [acc.orgId]);
    expect(ev.rows.map((x) => x.event_name)).toEqual(['Purchase', 'Refund']);
    expect(ev.rows[1].payload.custom_data.value).toBeUndefined();
  });
  it('Hotmart: compra cancelada não vira reembolso; aprovação depois gera Purchase', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client, { productIds: ['55'] });
    const integ = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
    const body = (event: string, status: string) => ({
      id: `evt-${event}`, event,
      data: { buyer: { email: 'h@h.com' }, product: { id: 55 }, purchase: { transaction: 'HP9', status, approved_date: Date.now() - 1000, price: { value: 97, currency_value: 'BRL' } } },
    });
    const h = { 'x-hotmart-hottok': 'HOTTOK' };
    expect((await post(integ.webhookUrl, body('PURCHASE_CANCELED', 'CANCELED'), h)).json()).toMatchObject({ status: 'canceled' });
    expect((await post(integ.webhookUrl, body('PURCHASE_APPROVED', 'APPROVED'), h)).json()).toMatchObject({ status: 'approved', eventName: 'Purchase' });
    const ev = await env.db.query(`SELECT event_id FROM capi_outbox WHERE org_id = $1`, [acc.orgId]);
    expect(ev.rows.map((r) => r.event_id)).toEqual(['hotmart_purchase_HP9']);
  });
});

describe('cenários 9/10/12/13/19 — entrega à Meta, falhas e reprocessamento', () => {
  async function purchase() {
    const { acc, send } = await kiwifySetup();
    await send(kiwify('paid'));
    return acc;
  }
  it('falha temporária → retry com backoff → sucesso; registra tentativas', async () => {
    const acc = await purchase();
    let calls = 0;
    env.fake.on(/\/events$/, () => (++calls === 1 ? json(503, { error: { code: 2, is_transient: true, message: 'Service temporarily unavailable' } }) : json(200, { events_received: 1, fbtrace_id: 'T2' })));
    await dispatchBatch(env.ctx);
    let o = (await env.db.query('SELECT id, status, attempts, next_attempt_at, last_error_class FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0];
    expect(o).toMatchObject({ status: 'pending', attempts: 1, last_error_class: 'retryable' });
    expect(new Date(o.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 10_000);
    // o token vai no corpo, nunca na URL
    expect(env.fake.calls[0]!.url).not.toContain('access_token');
    expect(JSON.parse(env.fake.calls[0]!.body!).access_token).toBe('EAAG-token-de-teste-123456');
    await env.db.query(`UPDATE capi_outbox SET next_attempt_at = now() WHERE id = $1`, [o.id]);
    await dispatchBatch(env.ctx);
    o = (await env.db.query('SELECT status, attempts, events_received, fbtrace_id FROM capi_outbox WHERE id = $1', [o.id])).rows[0];
    expect(o).toMatchObject({ status: 'sent', attempts: 2, events_received: 1, fbtrace_id: 'T2' });
    expect((await env.db.query('SELECT count(*)::int n FROM capi_attempts')).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('2xx sem events_received NÃO conta como enviado', async () => {
    const acc = await purchase();
    env.fake.on(/\/events$/, () => json(200, {}));
    await dispatchBatch(env.ctx);
    expect((await env.db.query('SELECT status FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0].status).toBe('pending');
  });

  it('token inválido (190) → dead + alerta crítico; reprocessar após corrigir não duplica', async () => {
    const acc = await purchase();
    env.fake.on(/\/events$/, () => json(400, { error: { code: 190, message: 'Error validating access token' } }));
    await dispatchBatch(env.ctx);
    const o = (await env.db.query('SELECT id, status FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0];
    expect(o.status).toBe('dead');
    const al = await acc.client.get('/v1/alerts');
    expect(al.data.alerts[0]).toMatchObject({ severity: 'critical', kind: 'capi_token' });

    env.fake.reset();
    metaOk(env.fake);
    const rq = await acc.client.post('/v1/events/requeue', { all: true });
    expect(rq.data.requeued).toBe(1);
    await dispatchBatch(env.ctx);
    const after = await env.db.query('SELECT count(*)::int n, max(status) s FROM capi_outbox WHERE org_id = $1', [acc.orgId]);
    expect(after.rows[0]).toEqual({ n: 1, s: 'sent' }); // mesmo registro, mesmo event_id
    expect((await acc.client.get('/v1/alerts')).data.alerts.every((a: any) => a.resolved_at)).toBe(true);
  });

  it('rate limit da Meta → espera mínima de 5 minutos', async () => {
    const acc = await purchase();
    env.fake.on(/\/events$/, () => json(400, { error: { code: 17, message: 'User request limit reached' } }));
    await dispatchBatch(env.ctx);
    const o = (await env.db.query('SELECT status, last_error_class, next_attempt_at FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0];
    expect(o.last_error_class).toBe('rate_limited');
    expect(new Date(o.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 4.5 * 60_000);
  });

  it('Meta indisponível (erro de rede) não perde o evento', async () => {
    const acc = await purchase();
    env.fake.on(/\/events$/, () => { throw new Error('ECONNRESET'); });
    await dispatchBatch(env.ctx);
    const o = (await env.db.query('SELECT status, last_error FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0];
    expect(o.status).toBe('pending');
    expect(o.last_error).toContain('ECONNRESET');
  });

  it('esgotar tentativas → dead e alerta de falha persistente', async () => {
    const acc = await purchase();
    env.fake.on(/\/events$/, () => json(500, {}));
    await env.db.query(`UPDATE capi_outbox SET attempts = $2 - 1 WHERE org_id = $1`, [acc.orgId, env.ctx.config.CAPI_MAX_ATTEMPTS]);
    await dispatchBatch(env.ctx);
    expect((await env.db.query('SELECT status FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0].status).toBe('dead');
  });
});

describe('compatibilidade com o legado', () => {
  it('URL antiga /api/webhook_gateway.php?gateway=&token= e checkout /api/webhook.php com Bearer', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const k = await newIntegration(acc.client, 'kiwify', { secret: 'segredo-k' });
    const raw = JSON.stringify(kiwify('paid', { order_id: 'LEG-1' }));
    const r1 = await env.app.inject({ method: 'POST', url: `/api/webhook_gateway.php?gateway=kiwify&token=${k.token}&signature=${signKiwify(raw, 'segredo-k')}`, payload: raw, headers: { 'content-type': 'application/json' } });
    expect(r1.json()).toMatchObject({ processed: true, status: 'approved' });

    const ck = await newIntegration(acc.client, 'checkout');
    const r2 = await post('/api/webhook.php', { event: 'payment.approved', transaction_id: 'CK-1', value: '49,90', customer: { email: 'z@z.com' } }, { authorization: `Bearer ${ck.token}` });
    expect(r2.json()).toMatchObject({ processed: true, status: 'approved' });
    const amt = await env.db.query(`SELECT amount_minor FROM payments WHERE transaction_id = 'CK-1'`);
    expect(amt.rows[0].amount_minor).toBe(4990n);
    // ping GET usado pelos painéis de gateway
    expect((await env.app.inject({ method: 'GET', url: '/api/webhook_gateway.php?gateway=lowify' })).json()).toMatchObject({ ping: true });
  });

  it('checkout próprio com segredo exige assinatura (P-10)', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout', { secret: 'whs_segredo' });
    const body = JSON.stringify({ event: 'paid', transaction_id: 'S-1', value: 10 });
    const noSig = await post('/v1/webhooks/checkout', body, { authorization: `Bearer ${ck.token}` });
    expect(noSig.statusCode).toBe(401);
    const sig = 'sha256=' + createHmac('sha256', 'whs_segredo').update(body).digest('hex');
    const ok = await post('/v1/webhooks/checkout', body, { authorization: `Bearer ${ck.token}`, 'x-paytrack-signature': sig });
    expect(ok.json()).toMatchObject({ processed: true });
  });

  it('roteamento por produto respeita a organização; produto sem pixel gera alerta', async () => {
    const a = await newAccount(env);
    const b = await newAccount(env);
    const pa = await newPixel(a.client, { name: 'A', productIds: ['SHARED'] });
    await newPixel(a.client, { name: 'A2', metaPixelId: '2222222222' });
    await newPixel(b.client, { name: 'B', productIds: ['SHARED'] });
    const ia = await newIntegration(a.client, 'checkout');
    await post('/v1/webhooks/checkout', { event: 'paid', transaction_id: 'R-1', value: 10, product_id: 'SHARED' }, { authorization: `Bearer ${ia.token}` });
    const p = await env.db.query(`SELECT pixel_id FROM payments WHERE transaction_id = 'R-1'`);
    expect(p.rows[0].pixel_id).toBe(pa.id);
    await post('/v1/webhooks/checkout', { event: 'paid', transaction_id: 'R-2', value: 10, product_id: 'NOPE' }, { authorization: `Bearer ${ia.token}` });
    const al = await a.client.get('/v1/alerts');
    expect(al.data.alerts.map((x: any) => x.kind)).toContain('sale_without_pixel');
  });
});
