import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '@pt/domain';
import { dispatchBatch } from '../src/capi/dispatcher.js';
import { refreshRates } from '../src/fx/service.js';
import { json, metaOk, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(() => env.fake.reset());

// data no fuso padrão das organizações de teste (a venda é do dia local; em UTC o dia vira às 21h em São Paulo)
const today = () => localDate(new Date(), 'America/Sao_Paulo');

async function seedRates(date = today()) {
  for (const [q, r] of [['BRL', '6.00000000'], ['USD', '1.08000000'], ['EUR', '1']] as const) {
    await env.db.query(`INSERT INTO fx_rates(rate_date, base, quote, rate, source) VALUES ($1, 'EUR', $2, $3, 'test') ON CONFLICT DO NOTHING`, [date, q, r]);
  }
}

const checkout = (token: string, body: object) =>
  env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });

describe('coleta do navegador (track)', () => {
  it('PageView/IC com o mesmo event_id do Pixel, dedup de reenvio, Purchase recusado', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client);
    const send = (body: object, headers: Record<string, string> = {}) =>
      env.app.inject({ method: 'POST', url: `/v1/collect?k=${px.publicKey}`, payload: JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://loja.com', 'user-agent': 'Mozilla/5.0 Test', 'x-forwarded-for': '177.20.30.40', ...headers } });
    const pv = await send({ event: 'page_view', event_id: 'pv-1', fbp: 'fb.1.1700000000000.42', external_id: 'xid-A', utm_campaign: 'Black', value: 99 });
    expect(pv.json()).toMatchObject({ success: true, queued: true, event_id: 'pv-1' });
    expect(pv.headers['access-control-allow-origin']).toBe('https://loja.com');
    expect((await send({ event: 'page_view', event_id: 'pv-1' })).json()).toMatchObject({ duplicate: true });
    const ic = await send({ event: 'checkout', event_id: 'ic-1', external_id: 'xid-A', email: 'v@v.com', value: '197,00' });
    expect(ic.json().queued).toBe(true);
    expect((await send({ event: 'purchase', event_id: 'p-1' })).statusCode).toBe(422);
    expect((await send({ event: 'refund', event_id: 'r-1' })).statusCode).toBe(422);

    const rows = await env.db.query(`SELECT event_name, event_id, payload FROM capi_outbox WHERE org_id = $1 ORDER BY id`, [acc.orgId]);
    expect(rows.rows.map((r) => [r.event_name, r.event_id])).toEqual([['PageView', 'pv-1'], ['InitiateCheckout', 'ic-1']]);
    const pvp = rows.rows[0].payload;
    expect(pvp.custom_data.value).toBeUndefined(); // PageView sem valor
    expect(pvp.user_data).toMatchObject({ fbp: 'fb.1.1700000000000.42', client_ip_address: '177.20.30.40', client_user_agent: 'Mozilla/5.0 Test' });
    expect(rows.rows[1].payload.custom_data).toMatchObject({ value: 197, currency: 'BRL' });
    expect((await env.app.inject({ method: 'POST', url: '/v1/collect?k=pt_px_invalida', payload: '{}', headers: { 'content-type': 'text/plain' } })).statusCode).toBe(401);
  });

  it('ponte de identidade: Purchase do gateway herda fbp/IP/UA/URL do navegador via xid', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client);
    await env.app.inject({ method: 'POST', url: `/v1/collect?k=${px.publicKey}`, payload: JSON.stringify({ event: 'checkout', event_id: 'ic-x', external_id: 'xid-B', fbp: 'fb.1.1.99', fbc: 'fb.1.2.IwAR9', event_source_url: 'https://loja.com/oferta' }), headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 Comprador', 'x-forwarded-for': '189.1.2.3' } });
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'ID-1', value: 50, customer: { email: 'c@c.com' }, tracking: { external_id: 'xid-B' } });
    const p = (await env.db.query(`SELECT payload FROM capi_outbox WHERE event_name = 'Purchase' AND org_id = $1`, [acc.orgId])).rows[0].payload;
    expect(p.user_data).toMatchObject({ fbp: 'fb.1.1.99', fbc: 'fb.1.2.IwAR9', client_ip_address: '189.1.2.3', client_user_agent: 'Mozilla/5.0 Comprador' });
    expect(p.event_source_url).toBe('https://loja.com/oferta');
  });
});

describe('cenários 14/15/16 — dashboard coerente e moedas', () => {
  it('total do dashboard = soma dos registros; EUR convertido pela cotação do dia; pendentes separados', async () => {
    await seedRates();
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'D-1', value: '100,00', currency: 'BRL' });
    await checkout(ck.token, { event: 'paid', transaction_id: 'D-2', value: '10,00', currency: 'EUR' });
    await checkout(ck.token, { event: 'pix_generated', transaction_id: 'D-3', value: '30,00', currency: 'BRL' });
    await checkout(ck.token, { event: 'paid', transaction_id: 'D-4', value: '50,00', currency: 'BRL' });
    await checkout(ck.token, { event: 'refunded', transaction_id: 'D-4', value: '50,00', currency: 'BRL' });

    const d = (await acc.client.get('/v1/reports/dashboard?preset=today')).data;
    const c = d.current;
    expect(c.sales).toBe(2);                       // D-1 + D-2 (D-4 foi reembolsada)
    expect(c.revenueMinor).toBe('16000');          // R$100 + €10×6,00 = R$160,00
    expect(c.refunds).toEqual({ count: 1, amountMinor: '5000' });
    expect(c.pending.count).toBe(1);               // PIX gerado não é venda
    expect(c.paymentsCreated).toBe(4);
    expect(c.approvalRate).toBeCloseTo(3 / 4);
    expect(c.unconvertedSales).toBe(0);

    // valor original preservado vs. normalizado
    const p = (await acc.client.get('/v1/payments?preset=today&search=D-2')).data.payments[0];
    expect([p.amount_minor, p.currency.trim()]).toEqual(['1000', 'EUR']);
    // coerência: recomputa a partir dos registros brutos
    const raw = await env.db.query(`SELECT amount_minor, currency FROM payments WHERE org_id = $1 AND status = 'approved'`, [acc.orgId]);
    const sum = raw.rows.reduce((s, r) => s + (r.currency.trim() === 'EUR' ? r.amount_minor * 6n : r.amount_minor), 0n);
    expect(String(sum)).toBe(c.revenueMinor);
  });

  it('sem cotação a venda NÃO é convertida em silêncio (sem fallback 1.0)', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'X-1', value: 10, currency: 'JPY' });
    const c = (await acc.client.get('/v1/reports/dashboard?preset=today')).data.current;
    expect(c.sales).toBe(1);
    expect(c.unconvertedSales).toBe(1);
    expect(c.revenueMinor).toBe('0');
  });

  it('metas: diária compara HOJE e mensal compara o mês (P-23)', async () => {
    await seedRates();
    const acc = await newAccount(env);
    await newPixel(acc.client);
    await acc.client.patch('/v1/org', { goalDaily: '1.000,00', goalMonthly: '30000' });
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'G-1', value: 250 });
    const g = (await acc.client.get('/v1/reports/dashboard?preset=last_30d')).data.goals;
    expect(g).toEqual({ daily: { goalMinor: '100000', achievedMinor: '25000' }, monthly: { goalMinor: '3000000', achievedMinor: '25000' } });
  });

  it('conciliação: venda aprovada × Purchase entregue', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'C-1', value: 10 });
    await checkout(ck.token, { event: 'paid', transaction_id: 'C-2', value: 10 });
    metaOk(env.fake);
    await dispatchBatch(env.ctx);
    const r = (await acc.client.get('/v1/reports/reconciliation?preset=today')).data;
    expect(r).toMatchObject({ approved: 2, purchase_sent: 2, purchase_dead: 0, not_queued: 0 });
  });

  it('atualização de câmbio grava cotações BCE com a data publicada', async () => {
    env.fake.on(/frankfurter/, () => json(200, { date: '2026-10-28', rates: { BRL: 6.2, USD: 1.07 } }));
    env.fake.on(/open\.er-api/, () => json(200, { result: 'success', time_last_update_unix: 1761609600, rates: { PYG: 8500 } }));
    const r = await refreshRates(env.ctx);
    expect(r.sources).toEqual(['ecb-frankfurter', 'open-er-api']);
    const q = await env.db.query(`SELECT rate::text FROM fx_rates WHERE rate_date = '2026-10-28' AND quote = 'BRL'`);
    expect(q.rows[0].rate).toBe('6.20000000');
  });
});

describe('cenários 11/12/13 — Meta OAuth e Marketing API', () => {
  it('OAuth: state inválido é recusado; state válido conecta e é de uso único', async () => {
    const acc = await newAccount(env);
    const bad = await env.app.inject({ method: 'GET', url: '/v1/meta/callback?code=abc&state=forjado' });
    expect(bad.statusCode).toBe(302);
    expect(bad.headers.location).toContain('error=');
    const { url } = (await acc.client.post('/v1/meta/connect')).data;
    const state = new URL(url).searchParams.get('state')!;
    env.fake.on(/oauth\/access_token/, (u) => json(200, { access_token: u.searchParams.get('grant_type') ? 'LONG' : 'SHORT', expires_in: 5_184_000 }));
    env.fake.on(/me\/permissions/, () => json(200, { data: [{ permission: 'ads_read', status: 'granted' }] }));
    const ok = await env.app.inject({ method: 'GET', url: `/v1/meta/callback?code=abc&state=${state}` });
    expect(ok.headers.location).toContain('connected=1');
    const reuse = await env.app.inject({ method: 'GET', url: `/v1/meta/callback?code=abc&state=${state}` });
    expect(reuse.headers.location).toContain('error=');
    const st = (await acc.client.get('/v1/meta/status')).data.connection;
    expect(st).toMatchObject({ status: 'active', scopes: ['ads_read'] });
    // token nunca exposto
    expect(JSON.stringify(st)).not.toContain('LONG');
  });

  it('campanhas: Meta + vendas rastreadas lado a lado; token revogado vira alerta e 409', async () => {
    await seedRates();
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_1', 'USD', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'M-1', value: 100, tracking: { utm_campaign: 'Campanha X|120000000000001' } });
    const insight = { spend: '10.00', impressions: '1000', clicks: '50', inline_link_clicks: '40', cpc: '0.20', ctr: '5', actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }, { action_type: 'purchase', value: '3' }], action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '30' }] };
    env.fake.on(/act_1\/campaigns/, () => json(200, { data: [{ id: '120000000000001', name: 'Campanha X', status: 'ACTIVE', daily_budget: '5000', insights: { data: [insight] } }] }));
    env.fake.on(/act_1\/adsets/, () => json(200, { data: [] }));
    const r = (await acc.client.get('/v1/meta/campaigns?preset=today')).data;
    expect(r.accountCurrency).toBe('USD');
    const row = r.rows[0];
    expect(row.spendMinor).toBe('5556');               // US$10 × (6.00/1.08) = R$55,56
    expect(row.meta).toEqual({ purchases: 3, revenueMinor: '16667' }); // sem contagem dupla (P-21)
    expect(row.tracked).toMatchObject({ sales: 1, revenueMinor: '10000' });
    expect(row.budget).toEqual({ type: 'daily', amountMinor: '5000', currency: 'USD' });
    // orçamento editado na moeda da conta, sem câmbio
    env.fake.on(/graph\.facebook\.com\/v[\d.]+\/120000000000001$/, () => json(200, { success: true }));
    const b = await acc.client.post('/v1/meta/entities/120000000000001/budget', { type: 'daily', amount: '75,50' });
    expect(b.data).toMatchObject({ amountMinor: '7550', currency: 'USD' });
    expect(env.fake.calls.at(-1)!.body).toContain('daily_budget=7550');

    await env.db.query('DELETE FROM meta_insights_cache');
    env.fake.on(/act_1\/campaigns/, () => json(400, { error: { code: 190, message: 'Session has expired' } }));
    const exp = await acc.client.get('/v1/meta/campaigns?preset=yesterday');
    expect(exp.status).toBe(409);
    expect((await env.db.query('SELECT status FROM meta_connections WHERE org_id = $1', [acc.orgId])).rows[0].status).toBe('expired');
    expect((await acc.client.get('/v1/alerts')).data.alerts[0].kind).toBe('meta_token');
  });

  it('sem permissão ads_management → 403 com orientação; rate limit → 429', async () => {
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency) VALUES ($1, $2, 'act_2', 'BRL')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    env.fake.on(/\/123456789012\/?$/, () => json(400, { error: { code: 200, message: 'Requires ads_management permission' } }));
    const r = await acc.client.post('/v1/meta/entities/123456789012/status', { status: 'PAUSED' });
    expect(r.status).toBe(403);
    expect(r.data.error.message).toContain('ads_management');
    env.fake.on(/act_2\/campaigns/, () => json(400, { error: { code: 17, message: 'User request limit reached' } }));
    expect((await acc.client.get('/v1/meta/campaigns?preset=today')).status).toBe(429);
  });
});

describe('aviso de venda (feed para o som/notificação do painel)', () => {
  it('só avisa vendas aprovadas depois do cursor, uma vez, e só da própria organização', async () => {
    const acc = await newAccount(env);
    const other = await newAccount(env);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    await checkout(ck.token, { event: 'paid', transaction_id: 'ANTIGA', value: 10 });

    const first = (await acc.client.get('/v1/sales/feed')).data;
    expect(first.sales).toEqual([]); // ao abrir o painel não toca pelo que já existia
    await new Promise((r) => setTimeout(r, 20));
    // a hora de pagamento informada pelo gateway pode ser antiga (webhook atrasado): vale a chegada
    env.now.value = new Date(Date.now() - 3600_000);
    await checkout(ck.token, { event: 'pix_generated', transaction_id: 'PEND', value: 30 });
    await checkout(ck.token, { event: 'paid', transaction_id: 'NOVA', value: '197,00', tracking: { utm_campaign: 'Black' } });

    const floor = `&floor=${encodeURIComponent(first.cursor)}`;
    const feed = (await acc.client.get(`/v1/sales/feed?after=${encodeURIComponent(first.cursor)}${floor}`)).data;
    expect(feed.sales.map((s: { transaction_id: string }) => s.transaction_id)).toEqual(['NOVA']);
    expect(feed.sales[0]).toMatchObject({ amount_minor: '19700', currency: 'BRL', utm_campaign: 'Black' });
    // a janela de segurança devolve de novo a mesma venda; o painel não toca duas vezes (guarda os ids)
    const again = (await acc.client.get(`/v1/sales/feed?after=${encodeURIComponent(feed.cursor)}${floor}`)).data;
    expect(again.sales.every((s: { transaction_id: string }) => s.transaction_id === 'NOVA')).toBe(true);
    const foreign = (await other.client.get(`/v1/sales/feed?after=${encodeURIComponent(first.cursor)}${floor}`)).data;
    expect(foreign.sales).toEqual([]); // isolamento entre organizações
  });
});
