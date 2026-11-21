import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, newAccount, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(() => env.fake.reset());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function connected() {
  const acc = await newAccount(env);
  await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_55', 'BRL', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
  return acc;
}
const campaigns = (name = 'Black') => ({ data: [{ id: '120000000000001', name, status: 'ACTIVE', insights: { data: [{ spend: '10.00', impressions: '1', clicks: '1' }] } }] });

describe('carga: pedidos nunca ficam presos esperando a Meta', () => {
  it('pedidos simultâneos iguais fazem UMA única chamada à Meta', async () => {
    const acc = await connected();
    let calls = 0;
    env.fake.on(/act_55\/campaigns/, async () => { calls++; await sleep(300); return json(200, campaigns()); });
    env.fake.on(/act_55\/adsets/, async () => { await sleep(300); return json(200, { data: [] }); });
    const rs = await Promise.all(Array.from({ length: 5 }, () => acc.client.get('/v1/meta/campaigns?preset=today')));
    expect(rs.every((r) => r.status === 200 && r.data.rows[0].name === 'Black')).toBe(true);
    expect(calls).toBe(1);
  });

  it('dado vencido aparece NA HORA (Meta lenta) e é atualizado em segundo plano', async () => {
    const acc = await connected();
    env.fake.on(/act_55\/campaigns/, () => json(200, campaigns('Antigo')));
    env.fake.on(/act_55\/adsets/, () => json(200, { data: [] }));
    expect((await acc.client.get('/v1/meta/campaigns?preset=today')).data.rows[0].name).toBe('Antigo');
    await env.db.query(`UPDATE meta_insights_cache SET fetched_at = now() - interval '1 hour' WHERE org_id = $1`, [acc.orgId]);
    env.fake.reset();
    env.fake.on(/act_55\/campaigns/, async () => { await sleep(1500); return json(200, campaigns('Novo')); });
    env.fake.on(/act_55\/adsets/, async () => { await sleep(1500); return json(200, { data: [] }); });
    const t0 = Date.now();
    const r = await acc.client.get('/v1/meta/campaigns?preset=today');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.data.rows[0].name).toBe('Antigo');
    await sleep(1800);
    expect((await acc.client.get('/v1/meta/campaigns?preset=today')).data.rows[0].name).toBe('Novo');
  });

  it('pedido que passa do tempo máximo responde 503 em vez de ficar aberto', async () => {
    const acc = await connected();
    const prev = env.ctx.config.REQUEST_TIMEOUT_MS;
    (env.ctx.config as { REQUEST_TIMEOUT_MS: number }).REQUEST_TIMEOUT_MS = 300;
    try {
      env.fake.on(/act_55\/campaigns/, async () => { await sleep(1500); return json(200, campaigns()); });
      env.fake.on(/act_55\/adsets/, async () => { await sleep(1500); return json(200, { data: [] }); });
      const t0 = Date.now();
      const r = await acc.client.get('/v1/meta/campaigns?preset=yesterday');
      expect(r.status).toBe(503);
      expect(r.data.error.code).toBe('timeout');
      expect(Date.now() - t0).toBeLessThan(1200);
    } finally {
      (env.ctx.config as { REQUEST_TIMEOUT_MS: number }).REQUEST_TIMEOUT_MS = prev;
      await sleep(1600); // deixa a chamada lenta terminar antes do próximo teste
    }
  });
});
