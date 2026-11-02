import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const DAY = 86_400_000;
const post = (url: string, body: unknown) =>
  env.app.inject({ method: 'POST', url: url.replace(API_URL, ''), payload: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-hotmart-hottok': 'HOTTOK' } });
const hotmart = (event: string, tx: string, approvedMsAgo: number, id = `${event}-${tx}`) => ({
  id, event,
  data: {
    buyer: { email: `${tx.toLowerCase()}@cliente.com`, name: 'Ana Lima', checkout_phone: '11999990000' }, product: { id: 77, name: 'Curso' },
    purchase: { transaction: tx, status: event === 'PURCHASE_COMPLETE' ? 'COMPLETED' : 'APPROVED', approved_date: Date.now() - approvedMsAgo, price: { value: 197, currency_value: 'BRL' } },
  },
});

async function account() {
  const acc = await newAccount(env);
  await newPixel(acc.client, { productIds: ['77'] });
  const ig = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
  const cursor = (await acc.client.get('/v1/sales/feed')).data.cursor;
  const q = async (sql: string, p: unknown[] = []) => (await env.db.query(sql, [acc.orgId, ...p])).rows;
  return { acc, url: ig.webhookUrl, cursor, q };
}

describe('Hotmart PURCHASE_COMPLETE (fim da garantia) não duplica venda', () => {
  it('venda importada do sistema antigo: o COMPLETE reconhece a mesma venda (sem nova venda, Purchase ou aviso)', async () => {
    const { acc, url, cursor, q } = await account();
    await env.db.query(`INSERT INTO payments(org_id, provider, transaction_id, status, amount_minor, currency, approved_at, created_at)
      VALUES ($1, 'legacy', 'HP-OLD-1', 'approved', 19700, 'BRL', now() - interval '20 days', now() - interval '20 days')`, [acc.orgId]);
    const r = await post(url, hotmart('PURCHASE_COMPLETE', 'HP-OLD-1', 20 * DAY));
    expect(r.json()).toMatchObject({ duplicate: true, reason: 'status_unchanged' });
    const rows = await q(`SELECT provider, status FROM payments WHERE org_id = $1 AND transaction_id = 'HP-OLD-1'`);
    expect(rows).toEqual([{ provider: 'hotmart', status: 'approved' }]); // uma venda só, agora ligada à Hotmart
    expect(await q(`SELECT 1 FROM capi_outbox WHERE org_id = $1 AND event_name = 'Purchase'`)).toHaveLength(0);
    expect((await acc.client.get(`/v1/sales/feed?after=${encodeURIComponent(cursor)}`)).data.sales).toHaveLength(0);
    expect((await acc.client.get('/v1/reports/dashboard?preset=today')).data.current.sales).toBe(0);
  });

  it('COMPLETE de venda que nunca passou por aqui: entra só como histórico, na data original', async () => {
    const { acc, url, cursor, q } = await account();
    const r = await post(url, hotmart('PURCHASE_COMPLETE', 'HP-OLD-2', 15 * DAY));
    expect(r.statusCode).toBeLessThan(300);
    const [p] = await q(`SELECT status, late_import, approved_at < now() - interval '14 days' AS old, created_at < now() - interval '14 days' AS old_created FROM payments WHERE org_id = $1 AND transaction_id = 'HP-OLD-2'`);
    expect(p).toEqual({ status: 'approved', late_import: true, old: true, old_created: true });
    expect(await q(`SELECT 1 FROM capi_outbox WHERE org_id = $1 AND event_name = 'Purchase'`)).toHaveLength(0); // nada de Purchase atrasado à Meta
    expect((await acc.client.get(`/v1/sales/feed?after=${encodeURIComponent(cursor)}`)).data.sales).toHaveLength(0); // sem som/aviso
    expect((await acc.client.get('/v1/reports/dashboard?preset=today')).data.current.sales).toBe(0);
    expect((await acc.client.get('/v1/reports/dashboard?preset=last_30d')).data.current.sales).toBe(1); // aparece no dia certo
  });

  it('fluxo normal: APPROVED conta a venda (com Purchase e aviso); o COMPLETE depois não muda nada', async () => {
    const { acc, url, cursor, q } = await account();
    await post(url, hotmart('PURCHASE_APPROVED', 'HP-NEW-1', 1000));
    await post(url, hotmart('PURCHASE_COMPLETE', 'HP-NEW-1', 1000));
    expect(await q(`SELECT status, late_import FROM payments WHERE org_id = $1`)).toEqual([{ status: 'approved', late_import: false }]);
    expect(await q(`SELECT 1 FROM capi_outbox WHERE org_id = $1 AND event_name = 'Purchase'`)).toHaveLength(1);
    expect((await acc.client.get(`/v1/sales/feed?after=${encodeURIComponent(cursor)}`)).data.sales).toHaveLength(1);
    expect((await acc.client.get('/v1/reports/dashboard?preset=today')).data.current.sales).toBe(1);
  });

  it('"Corrigir vendas duplicadas": junta as cópias que já existem numa venda só, na data original', async () => {
    const { acc, q } = await account();
    // como ficou em produção antes da correção: cópia do sistema antigo + cópia criada pelo COMPLETE
    await env.db.query(`INSERT INTO payments(org_id, provider, transaction_id, status, amount_minor, currency, approved_at, created_at, utm_campaign)
      VALUES ($1, 'legacy', 'HP-DUP-1', 'approved', 19700, 'BRL', now() - interval '25 days', now() - interval '25 days', 'Black|1202'),
             ($1, 'hotmart', 'HP-DUP-1', 'approved', 19700, 'BRL', now() - interval '25 days' + interval '1 minute', now(), NULL),
             ($1, 'legacy', 'HP-SO-ANTIGA', 'approved', 9700, 'BRL', now() - interval '40 days', now() - interval '40 days', NULL)`, [acc.orgId]);
    const before = (await acc.client.get('/v1/reports/dashboard?preset=last_30d')).data.current;
    expect(before.sales).toBe(2); // contada duas vezes
    const r = await acc.client.post('/v1/payments/fix-duplicates');
    expect(r.data).toMatchObject({ merged: 1 });
    const rows = await q(`SELECT provider, transaction_id, utm_campaign, late_import, created_at < now() - interval '24 days' AS old FROM payments WHERE org_id = $1 ORDER BY transaction_id`);
    expect(rows).toEqual([
      { provider: 'hotmart', transaction_id: 'HP-DUP-1', utm_campaign: 'Black|1202', late_import: true, old: true },
      { provider: 'legacy', transaction_id: 'HP-SO-ANTIGA', utm_campaign: null, late_import: false, old: true }, // sem par: intocada
    ]);
    const after = (await acc.client.get('/v1/reports/dashboard?preset=last_30d')).data.current;
    expect([after.sales, after.revenueMinor]).toEqual([1, '19700']);
    const log = (await q(`SELECT metadata FROM audit_log WHERE org_id = $1 AND action = 'payment.duplicate_merged'`))[0].metadata;
    expect(log.removedLegacyRow).toMatchObject({ provider: 'legacy', transaction_id: 'HP-DUP-1' }); // dá para conferir/restaurar
    expect((await acc.client.post('/v1/payments/fix-duplicates')).data).toMatchObject({ merged: 0 }); // idempotente
  });
});
