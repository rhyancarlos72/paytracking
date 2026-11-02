import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

/** Tudo que um painel novo lê ao abrir as abas. */
const READS = [
  '/v1/pixels', '/v1/integrations', '/v1/payments?preset=last_90d', '/v1/events?preset=last_90d', '/v1/alerts', '/v1/webhook-receipts',
  '/v1/reports/dashboard?preset=last_90d', '/v1/reports/attribution?preset=last_90d&dimension=utm_campaign', '/v1/reports/capi?preset=last_90d',
  '/v1/reports/coverage?preset=last_90d', '/v1/reports/reconciliation?preset=last_90d', '/v1/reports/monthly-goal', '/v1/org/members', '/v1/org/audit',
  '/v1/push/devices', '/v1/me/sale-sound', '/v1/meta/status', '/v1/billing', '/v1/sales/feed',
];

describe('cada conta começa do zero e só enxerga o que é dela', () => {
  it('conta nova: nenhum pixel, integração, venda, evento, alerta ou dispositivo — só ela como dona, em teste grátis', async () => {
    // outra conta com dados de verdade antes, para provar que nada "vaza" para a nova
    const old = await newAccount(env);
    const px = await newPixel(old.client, { name: 'Pixel Secreto Antigo', productIds: ['P-OLD'] });
    const ig = await newIntegration(old.client, 'checkout');
    await env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify({ event: 'paid', transaction_id: 'TX-SECRETA-1', value: '97,00', utm_campaign: 'Campanha Secreta' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${ig.token}` } });
    await env.app.inject({ method: 'POST', url: `/v1/collect?k=${px.publicKey}`, payload: JSON.stringify({ event: 'page_view', event_id: 'pv-secreto', event_source_url: 'https://loja-antiga.com/' }), headers: { 'content-type': 'text/plain' } });
    await env.db.query('UPDATE organizations SET goal_monthly_minor = 999900 WHERE id = $1', [old.orgId]);

    const fresh = await newAccount(env);
    const c = fresh.client;
    const secrets = [old.email, old.orgId, px.id, px.publicKey, 'Pixel Secreto Antigo', ig.integration.id, 'TX-SECRETA-1', 'Campanha Secreta', 'loja-antiga.com', 'pv-secreto'];
    for (const url of READS) {
      const r = await c.get(url);
      expect([200, 204], url).toContain(r.status);
      const body = JSON.stringify(r.data);
      for (const s of secrets) expect(body.includes(s), `${url} vazou "${s}"`).toBe(false);
    }
    expect((await c.get('/v1/pixels')).data.pixels).toEqual([]);
    expect((await c.get('/v1/integrations')).data.integrations).toEqual([]);
    expect((await c.get('/v1/payments?preset=last_90d')).data.total).toBe(0);
    expect((await c.get('/v1/alerts')).data.alerts).toEqual([]);
    expect((await c.get('/v1/push/devices')).data.devices).toEqual([]);
    const d = (await c.get('/v1/reports/dashboard?preset=last_90d')).data;
    expect(d.current).toMatchObject({ sales: 0, revenueMinor: '0', paymentsCreated: 0, byProvider: [] });
    expect(d.events.received).toBe(0);
    expect((await c.get('/v1/reports/monthly-goal')).data).toMatchObject({ goalMinor: '0', achievedMinor: '0', sales: 0 });
    expect((await c.get('/v1/meta/status')).data.connection).toBeNull();
    const members = (await c.get('/v1/org/members')).data.members;
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ email: fresh.email, role: 'owner' });
    const me = (await c.get('/v1/auth/me')).data;
    expect(me.user.isPlatformAdmin).toBe(false);
    expect(me.plan.status).toBe('trial');
    expect(me.org.id).not.toBe(old.orgId);
  });

  it('não lê nem altera nada de outra conta pelos ids (rotas novas incluídas)', async () => {
    const a = await newAccount(env);
    const b = await newAccount(env);
    const pa = await newPixel(a.client, { productIds: ['A-9'] });
    const ia = await newIntegration(a.client, 'checkout');
    await env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify({ event: 'paid', transaction_id: 'A-TX-9', value: 10 }), headers: { 'content-type': 'application/json', authorization: `Bearer ${ia.token}` } });
    const payA = (await env.db.query(`SELECT id FROM payments WHERE transaction_id = 'A-TX-9'`)).rows[0].id;
    await env.db.query(`INSERT INTO alerts(org_id, kind, severity, message) VALUES ($1, 'teste', 'warn', 'alerta de A')`, [a.orgId]).catch(() => undefined);
    const alertA = (await env.db.query('SELECT id FROM alerts WHERE org_id = $1 LIMIT 1', [a.orgId])).rows[0]?.id;

    const tries: Array<[string, string, unknown?]> = [
      ['GET', `/v1/payments/${payA}`],
      ['PUT', `/v1/pixels/${pa.id}`, { name: 'x', metaPixelId: '999999999' }],
      ['DELETE', `/v1/pixels/${pa.id}`],
      ['POST', `/v1/pixels/${pa.id}/toggle`, {}],
      ['POST', `/v1/pixels/${pa.id}/verify`, {}],
      ['POST', `/v1/pixels/${pa.id}/rotate-key`, {}],
      ['PATCH', `/v1/integrations/${ia.integration.id}`, { name: 'x' }],
      ['POST', `/v1/integrations/${ia.integration.id}/rotate-token`, {}],
      ['DELETE', `/v1/integrations/${ia.integration.id}`],
      ['DELETE', `/v1/org/members/${a.userId}`],
      ['PATCH', `/v1/org/members/${a.userId}`, { role: 'viewer' }],
      ...(alertA ? [['POST', `/v1/alerts/${alertA}/resolve`, {}] as [string, string, unknown]] : []),
    ];
    for (const [m, u, body] of tries) {
      const r = await b.client.req(m, u, body);
      expect([403, 404], `${m} ${u} → ${r.status}`).toContain(r.status);
    }
    // ações em lote só afetam a própria conta
    await b.client.post('/v1/pixels/bulk-active', { ids: [pa.id], active: false });
    await b.client.post('/v1/payments/recover-utms');
    await b.client.post('/v1/events/requeue', { ids: [] }).catch(() => undefined);
    await b.client.post('/v1/auth/switch-org', { orgId: a.orgId });
    expect((await b.client.get('/v1/auth/me')).data.org.id).toBe(b.orgId);
    // tudo de A continua intacto
    const px = (await a.client.get('/v1/pixels')).data.pixels[0];
    expect(px).toMatchObject({ id: pa.id, active: true, publicKey: pa.publicKey });
    expect((await a.client.get(`/v1/payments/${payA}`)).status).toBe(200);
    expect((await a.client.get('/v1/integrations')).data.integrations).toHaveLength(1);
    expect((await a.client.get('/v1/org/members')).data.members).toHaveLength(1);
  });
});
