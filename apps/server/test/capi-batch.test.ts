import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatchBatch } from '../src/capi/dispatcher.js';
import { json, metaOk, newAccount, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(async () => {
  env.fake.reset();
  await env.db.query(`UPDATE capi_outbox SET status = 'dead' WHERE status IN ('pending', 'sending')`); // isola o teste
});

async function pageViews(n: number) {
  const acc = await newAccount(env);
  const px = await newPixel(acc.client);
  for (let i = 0; i < n; i++) {
    const r = await env.app.inject({
      method: 'POST', url: `/v1/collect?k=${px.publicKey}`, payload: JSON.stringify({ event: 'page_view', event_id: `pv-${i}`, external_id: `x-${i}` }),
      headers: { 'content-type': 'text/plain', origin: 'https://loja.com', 'x-forwarded-for': `177.0.0.${i + 1}` },
    });
    expect(r.json().queued).toBe(true);
  }
  return acc;
}
const eventCalls = () => env.fake.calls.filter((c) => c.url.includes('/events'));
const statuses = async (orgId: string) =>
  (await env.db.query(`SELECT event_id, status, events_received FROM capi_outbox WHERE org_id = $1 ORDER BY event_id`, [orgId])).rows;

describe('CAPI em lote por pixel', () => {
  it('vários eventos do mesmo pixel saem numa única chamada e todos ficam "sent"', async () => {
    const acc = await pageViews(5);
    metaOk(env.fake);
    const s = await dispatchBatch(env.ctx);
    expect(s).toMatchObject({ claimed: 5, sent: 5, retried: 0, dead: 0 });
    expect(eventCalls()).toHaveLength(1);
    const body = JSON.parse(eventCalls()[0]!.body!);
    expect(body.data.map((e: { event_id: string }) => e.event_id).sort()).toEqual(['pv-0', 'pv-1', 'pv-2', 'pv-3', 'pv-4']);
    expect((await statuses(acc.orgId)).every((r) => r.status === 'sent' && r.events_received === 1)).toBe(true);
    expect((await env.db.query(`SELECT count(*)::int n FROM capi_attempts a JOIN capi_outbox o ON o.id = a.outbox_id WHERE o.org_id = $1`, [acc.orgId])).rows[0].n).toBe(5);
  });

  it('lote recusado por um evento ruim: os outros são reenviados sozinhos e entregues; só o ruim morre', async () => {
    const acc = await pageViews(3);
    env.fake.on(/\/events$/, (_u, init) => {
      const data = JSON.parse(String(init?.body)).data as Array<{ event_id: string }>;
      if (data.some((e) => e.event_id === 'pv-1')) return json(400, { error: { code: 100, message: 'Invalid parameter', fbtrace_id: 'BAD' } });
      return json(200, { events_received: data.length, fbtrace_id: 'OK' });
    });
    const s = await dispatchBatch(env.ctx);
    expect(s).toMatchObject({ claimed: 3, sent: 2, dead: 1 });
    expect(eventCalls()).toHaveLength(4); // 1 lote + 3 individuais
    expect((await statuses(acc.orgId)).map((r) => [r.event_id, r.status])).toEqual([['pv-0', 'sent'], ['pv-1', 'dead'], ['pv-2', 'sent']]);
  });

  it('erro temporário no lote: todos voltam para a fila (nenhum perdido, nenhum duplicado)', async () => {
    const acc = await pageViews(3);
    env.fake.on(/\/events$/, () => json(503, { error: { code: 2, is_transient: true, message: 'Service temporarily unavailable' } }));
    const s = await dispatchBatch(env.ctx);
    expect(s).toMatchObject({ claimed: 3, retried: 3 });
    expect(eventCalls()).toHaveLength(1);
    expect((await statuses(acc.orgId)).every((r) => r.status === 'pending')).toBe(true);
  });

  it('token inválido no lote: todos "dead" com um único alerta, sem martelar a Meta evento por evento', async () => {
    const acc = await pageViews(3);
    env.fake.on(/\/events$/, () => json(400, { error: { code: 190, message: 'Error validating access token' } }));
    await dispatchBatch(env.ctx);
    expect(eventCalls()).toHaveLength(1);
    expect((await statuses(acc.orgId)).every((r) => r.status === 'dead')).toBe(true);
    const al = await acc.client.get('/v1/alerts');
    expect(al.data.alerts.filter((a: { kind: string }) => a.kind === 'capi_token')).toHaveLength(1);
  });

  it('aceite parcial (events_received menor que o lote): reenvia um a um com o mesmo event_id', async () => {
    const acc = await pageViews(2);
    let first = true;
    env.fake.on(/\/events$/, () => { if (first) { first = false; return json(200, { events_received: 1 }); } return json(200, { events_received: 1 }); });
    const s = await dispatchBatch(env.ctx);
    expect(s).toMatchObject({ claimed: 2, sent: 2 });
    expect(eventCalls()).toHaveLength(3);
    const ids = eventCalls().slice(1).map((c) => JSON.parse(c.body!).data[0].event_id).sort();
    expect(ids).toEqual(['pv-0', 'pv-1']);
    expect((await statuses(acc.orgId)).every((r) => r.status === 'sent')).toBe(true);
  });
});
