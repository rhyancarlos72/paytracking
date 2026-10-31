import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  env.app.inject({ method: 'POST', url: url.replace(API_URL, ''), payload: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

/** Visita na página de vendas vinda do anúncio (o que o pixel.js envia). */
const visit = (key: string, xid: string, utms: Record<string, string>) => env.app.inject({
  method: 'POST', url: `/v1/collect?k=${key}`,
  payload: JSON.stringify({ event: 'checkout', event_id: `ic-${xid}`, external_id: xid, fbp: 'fb.1.1793370000000.123456', event_source_url: 'https://loja.com/oferta', ...utms }),
  headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 Comprador', 'x-forwarded-for': '189.1.2.3' },
});

// parâmetros de URL recomendados (nome|id)
const UTMS = {
  utm_source: 'FB', utm_campaign: 'BLACK FRIDAY | CBO|120210000000001', utm_medium: 'Lookalike 1%|120210000000011',
  utm_content: 'Criativo 03|120210000000111', utm_term: 'Instagram_Feed',
};

/** Webhook da Hotmart: só devolve xcod/sck/src — nunca utm_*. */
const hotmart = (tx: string, xcod: string) => ({
  id: `evt-${tx}`, event: 'PURCHASE_APPROVED',
  data: {
    buyer: { email: `${tx.toLowerCase()}@cliente.com` }, product: { id: 77 },
    purchase: { transaction: tx, status: 'APPROVED', approved_date: Date.now() - 1000, price: { value: 7.9, currency_value: 'EUR' }, origin: { xcod, sck: xcod, src: 'FB' } },
  },
});

describe('Hotmart: campanha da venda pela ponte de identidade', () => {
  it('xcod só com o external_id: a venda no painel recebe a campanha, o conjunto e o anúncio do visitante', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client, { productIds: ['77'] });
    const integ = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
    expect((await visit(px.publicKey, 'xid-visitante-1', UTMS)).statusCode).toBeLessThan(300);
    const r = await post(integ.webhookUrl, hotmart('HP1021157740', 'external_id=xid-visitante-1'), { 'x-hotmart-hottok': 'HOTTOK' });
    expect(r.json()).toMatchObject({ status: 'approved' });
    const p = (await env.db.query('SELECT utm_source, utm_campaign, utm_medium, utm_content, utm_term FROM payments WHERE transaction_id = $1', ['HP1021157740'])).rows[0];
    expect(p).toEqual({ utm_source: 'FB', utm_campaign: UTMS.utm_campaign, utm_medium: UTMS.utm_medium, utm_content: UTMS.utm_content, utm_term: 'Instagram_Feed' });
  });

  it('xcod com UTMs "nome|id" (codificadas) não é quebrado no "|"', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client, { productIds: ['77'] });
    const integ = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
    // o que o pixel.js monta (valores com encodeURIComponent), sem visita registrada
    const xcod = `external_id=xid-sem-visita&utm_campaign=${encodeURIComponent('Remarketing|120210000000002')}&utm_medium=${encodeURIComponent('Quente|120210000000022')}`;
    await post(integ.webhookUrl, hotmart('HP0169708424', xcod), { 'x-hotmart-hottok': 'HOTTOK' });
    const p = (await env.db.query('SELECT utm_campaign, utm_medium FROM payments WHERE transaction_id = $1', ['HP0169708424'])).rows[0];
    expect(p).toEqual({ utm_campaign: 'Remarketing|120210000000002', utm_medium: 'Quente|120210000000022' });
  });

  it('"Recuperar campanhas": vendas que chegaram sem UTM ganham a campanha depois, sem reenviar nada à Meta', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client, { productIds: ['77'] });
    const integ = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
    // venda chega ANTES de a visita estar registrada (como as vendas antigas sem campanha)
    await post(integ.webhookUrl, hotmart('HP555', 'external_id=xid-tardio'), { 'x-hotmart-hottok': 'HOTTOK' });
    const before = (await env.db.query('SELECT utm_campaign FROM payments WHERE transaction_id = $1', ['HP555'])).rows[0];
    expect(before.utm_campaign).toBeNull();
    const outboxBefore = (await env.db.query('SELECT count(*)::int AS n FROM capi_outbox WHERE org_id = $1', [acc.orgId])).rows[0].n;
    await visit(px.publicKey, 'xid-tardio', UTMS);
    const r = await acc.client.post('/v1/payments/recover-utms');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ recovered: 1 });
    const after = (await env.db.query('SELECT utm_campaign, utm_content FROM payments WHERE transaction_id = $1', ['HP555'])).rows[0];
    expect(after).toEqual({ utm_campaign: UTMS.utm_campaign, utm_content: UTMS.utm_content });
    // só a visita entrou na fila; a recuperação não gera evento
    const outboxAfter = (await env.db.query(`SELECT count(*)::int AS n FROM capi_outbox WHERE org_id = $1 AND event_name <> 'InitiateCheckout'`, [acc.orgId])).rows[0].n;
    expect(outboxAfter).toBe(outboxBefore);
    // rodar de novo não muda nada
    expect((await acc.client.post('/v1/payments/recover-utms')).data).toMatchObject({ recovered: 0 });
  });
});
