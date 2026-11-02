import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maintenance } from '../src/worker.js';
import { cleanupEvents } from '../src/maintenance/events.js';
import { newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const checkout = (token: string, body: object) =>
  env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
const collect = (key: string, body: object) =>
  env.app.inject({ method: 'POST', url: `/v1/collect?k=${key}`, payload: JSON.stringify(body), headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 Teste', 'x-forwarded-for': '189.1.2.3' } });

describe('limpeza de eventos: 3 dias (Purchase 6) sem mudar nenhum número', () => {
  it('apaga os eventos antigos, guarda as contagens e nada muda em vendas, faturamento, funil, atribuição e entregas', async () => {
    const acc = await newAccount(env);
    const c = acc.client;
    const px = await newPixel(c);
    const ig = await newIntegration(c, 'checkout');
    const camp = { utm_source: 'FB', utm_campaign: 'Black|1202', utm_medium: 'Conjunto A|1203' };
    // 12 visitas e 5 checkouts, de visitantes diferentes
    for (let i = 0; i < 12; i++) await collect(px.publicKey, { event: 'page_view', event_id: `pv-${i}`, external_id: `x${i}`, fbp: `fb.1.1793370000000.${i}`, event_source_url: 'https://loja.com/oferta', ...camp });
    for (let i = 0; i < 5; i++) await collect(px.publicKey, { event: 'checkout', event_id: `ic-${i}`, external_id: `x${i}`, event_source_url: 'https://loja.com/oferta', ...camp });
    // 3 vendas aprovadas (Purchase na fila da Meta)
    for (const [tx, v] of [['V-1', '97,00'], ['V-2', '197,00'], ['V-3', '47,00']] as const) {
      expect((await checkout(ig.token, { event: 'paid', transaction_id: tx, value: v, tracking: { ...camp, external_id: 'x1' } })).statusCode).toBeLessThan(300);
    }
    const outbox = async () => (await env.db.query('SELECT event_name, status, count(*)::int AS n FROM capi_outbox WHERE org_id = $1 GROUP BY 1, 2 ORDER BY 1, 2', [acc.orgId])).rows;
    expect((await outbox()).length).toBeGreaterThan(0);

    // simula a passagem do tempo: tudo entregue à Meta, menos 1 PageView que continua na fila
    await env.db.query(`UPDATE capi_outbox SET status = 'sent', sent_at = created_at + interval '2 seconds' WHERE org_id = $1`, [acc.orgId]);
    const keepPending = (await env.db.query(`SELECT id FROM capi_outbox WHERE org_id = $1 AND event_name = 'PageView' ORDER BY id LIMIT 1`, [acc.orgId])).rows[0].id;
    await env.db.query(`UPDATE capi_outbox SET status = 'pending' WHERE id = $1`, [keepPending]);
    // eventos de 4 dias atrás (passam do limite de 3); V-1 e V-2 aprovadas há 4 dias, V-3 há 7 dias
    await env.db.query(`UPDATE tracking_events SET received_at = received_at - interval '4 days' WHERE org_id = $1`, [acc.orgId]);
    await env.db.query(`UPDATE capi_outbox SET created_at = created_at - interval '4 days', sent_at = sent_at - interval '4 days' WHERE org_id = $1 AND event_name <> 'Purchase'`, [acc.orgId]);
    await env.db.query(`UPDATE payments SET created_at = created_at - interval '4 days', approved_at = approved_at - interval '4 days' WHERE org_id = $1 AND transaction_id IN ('V-1', 'V-2')`, [acc.orgId]);
    await env.db.query(`UPDATE payments SET created_at = created_at - interval '7 days', approved_at = approved_at - interval '7 days' WHERE org_id = $1 AND transaction_id = 'V-3'`, [acc.orgId]);
    await env.db.query(
      `UPDATE capi_outbox o SET created_at = p.approved_at, sent_at = p.approved_at + interval '2 seconds' FROM payments p WHERE o.payment_id = p.id AND o.org_id = $1 AND o.event_name = 'Purchase'`, [acc.orgId]);

    const P = 'preset=last_30d';
    const snapshot = async () => {
      const d = (await c.get(`/v1/reports/dashboard?${P}`)).data;
      return {
        vendas: d.current.sales, faturamento: d.current.revenueMinor, funil: d.current.funnel, conversao: d.current.conversionRate,
        eventos: d.events, metaMes: d.goals.monthly.achievedMinor,
        atribuicao: (await c.get(`/v1/reports/attribution?${P}&dimension=utm_campaign`)).data.rows,
        cobertura: (({ total, presence, byEvent, periods }) => ({ total, presence, byEvent, periods }))((await c.get(`/v1/reports/coverage?${P}`)).data),
        entregas: (await c.get(`/v1/reports/capi?${P}`)).data.byPixel,
        conciliacao: (await c.get(`/v1/reports/reconciliation?${P}`)).data,
        vendasLista: (await c.get(`/v1/payments?${P}`)).data.payments.map((p: any) => [p.transaction_id, p.status, p.amount_minor, p.utm_campaign, p.purchase_capi_status]),
      };
    };
    const before = await snapshot();
    expect(before.vendas).toBe(3);
    expect(before.funil).toMatchObject({ pageViews: 12, initiateCheckouts: 5, sales: 3 });
    expect(before.conciliacao).toMatchObject({ approved: 3, purchase_sent: 3, not_queued: 0 });

    const r = await cleanupEvents(env.ctx);
    expect(r.trackingEvents).toBe(17);                        // 12 PageView + 5 InitiateCheckout, todos com 4 dias
    expect(r.purchasesArchived).toBe(1);                      // só o Purchase de 7 dias (V-3); os de 4 dias ficam
    const left = await outbox();
    expect(left).toEqual(expect.arrayContaining([{ event_name: 'Purchase', status: 'sent', n: 2 }, { event_name: 'PageView', status: 'pending', n: 1 }]));
    expect(left.reduce((n: number, x: any) => n + x.n, 0)).toBe(3); // o resto foi apagado
    expect((await env.db.query('SELECT count(*)::int AS n FROM tracking_events WHERE org_id = $1', [acc.orgId])).rows[0].n).toBe(0);

    // nenhum número mudou
    expect(await snapshot()).toEqual(before);
    // rodar de novo (manutenção de hora em hora) não soma duas vezes
    await maintenance(env.ctx);
    expect(await snapshot()).toEqual(before);

    // a venda antiga lembra que o Purchase foi entregue e nunca é reenviada
    expect((await env.db.query(`SELECT purchase_capi_status FROM payments WHERE org_id = $1 AND transaction_id = 'V-3'`, [acc.orgId])).rows[0].purchase_capi_status).toBe('sent');
    await checkout(ig.token, { event: 'refunded', transaction_id: 'V-3', value: '47,00' });
    await checkout(ig.token, { event: 'paid', transaction_id: 'V-3', value: '47,00' });
    expect((await env.db.query(`SELECT count(*)::int AS n FROM capi_outbox WHERE org_id = $1 AND event_name = 'Purchase'`, [acc.orgId])).rows[0].n).toBe(2);
    // as identidades dos visitantes (atribuição de venda atrasada) não são tocadas
    expect((await env.db.query('SELECT count(*)::int AS n FROM visitor_identities WHERE org_id = $1', [acc.orgId])).rows[0].n).toBeGreaterThanOrEqual(12);
  });
});
