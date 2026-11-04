import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const checkout = (token: string, body: object) =>
  env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
const ins = (spend: string) => ({ data: [{ spend, impressions: '1000', clicks: '30', inline_link_clicks: '20', ctr: '3', actions: [], action_values: [] }] });

describe('vendas rastreadas com conjuntos/campanhas de nomes repetidos (cópias duplicadas)', () => {
  it('a venda vai para o conjunto e a campanha do ID da UTM — nunca para a cópia pausada com o mesmo nome', async () => {
    for (const [q, r] of [['BRL', '6.00000000'], ['EUR', '1']] as const) {
      await env.db.query(`INSERT INTO fx_rates(rate_date, base, quote, rate, source) VALUES ($1, 'EUR', $2, $3, 'test') ON CONFLICT DO NOTHING`, [today(), q, r]);
    }
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_9', 'BRL', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    await newPixel(acc.client);
    const ck = await newIntegration(acc.client, 'checkout');
    // campanha antiga (pausada) e a cópia ativa: mesmos nomes de campanha E de conjunto; uma campanha
    // nova chamada "G4A" — o mesmo nome do conjunto
    env.fake.on(/act_9\/campaigns/, () => json(200, { data: [
      { id: '120200000000001', name: 'G4A', status: 'PAUSED', effective_status: 'PAUSED', insights: ins('0') },
      { id: '120200000000002', name: 'G4A', status: 'ACTIVE', effective_status: 'ACTIVE', insights: ins('10.05') },
    ] }));
    env.fake.on(/act_9\/adsets/, () => json(200, { data: [
      { id: '120210000000001', name: 'G4A', status: 'PAUSED', effective_status: 'PAUSED', campaign_id: '120200000000001', campaign: { name: 'G4A' }, insights: ins('0') },
      { id: '120210000000002', name: 'G4A', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: '120200000000002', campaign: { name: 'G4A' }, insights: ins('10.05') },
    ] }));
    // 2 vendas com os parâmetros de URL recomendados, vindas da cópia ATIVA
    for (const tx of ['DUP-1', 'DUP-2']) {
      await checkout(ck.token, { event: 'paid', transaction_id: tx, value: '19,42', currency: 'BRL',
        tracking: { utm_source: 'FB', utm_campaign: 'G4A|120200000000002', utm_medium: 'G4A|120210000000002', utm_content: 'Criativo 1|120220000000002' } });
    }
    const adsets = (await acc.client.get('/v1/meta/campaigns?preset=today&level=adset')).data.rows;
    const byId = (rows: any[], id: string) => rows.find((r) => r.id === id).tracked.sales;
    expect(byId(adsets, '120210000000002')).toBe(2); // conjunto ativo
    expect(byId(adsets, '120210000000001')).toBe(0); // antes: a cópia pausada (1ª da lista) ficava com as vendas
    await env.db.query('DELETE FROM meta_insights_cache');
    const camps = (await acc.client.get('/v1/meta/campaigns?preset=today&level=campaign')).data.rows;
    expect(byId(camps, '120200000000002')).toBe(2);
    expect(byId(camps, '120200000000001')).toBe(0);
  });
});
