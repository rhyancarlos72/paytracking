import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const collect = (key: string, body: object) => env.app.inject({
  method: 'POST', url: `/v1/collect?k=${key}`, payload: JSON.stringify(body),
  headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (iPhone) Comprador', 'x-forwarded-for': '189.40.1.2' },
});
const payloadOf = async (orgId: string, name: string, id?: string) => (await env.db.query(
  `SELECT payload FROM capi_outbox WHERE org_id = $1 AND event_name = $2 ${id ? 'AND event_id = $3' : ''} ORDER BY id DESC LIMIT 1`, id ? [orgId, name, id] : [orgId, name])).rows[0]?.payload;

describe('qualidade de correspondência na Meta', () => {
  it('Hotmart: Purchase com telefone COM DDI, país, e-mail, nome, cidade e fbp/fbc/IP/UA do clique no anúncio', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client, { productIds: ['77'] });
    const ig = await newIntegration(acc.client, 'hotmart', { secret: 'HOTTOK' });
    // o comprador clicou no anúncio e passou pela página de vendas (pixel do PayTracking)
    await collect(px.publicKey, { event: 'checkout', event_id: 'ic-hot-1', external_id: 'xid-hot-1', fbp: 'fb.1.1793370000000.111', fbc: 'fb.1.1793370000000.IwAR-clique', event_source_url: 'https://loja.com/oferta' });
    const r = await env.app.inject({
      method: 'POST', url: ig.webhookUrl.replace(API_URL, ''), headers: { 'content-type': 'application/json', 'x-hotmart-hottok': 'HOTTOK' },
      payload: JSON.stringify({ id: 'evt-mq-1', event: 'PURCHASE_APPROVED', data: {
        buyer: { email: 'Ana.Lima@Gmail.com', name: 'Ana Lima', checkout_phone: '11999990000', address: { city: 'São Paulo', state: 'SP', zipcode: '01310-100' } },
        product: { id: 77, name: 'Curso' },
        purchase: { transaction: 'HP-MQ-1', status: 'APPROVED', approved_date: Date.now() - 1000, price: { value: 197, currency_value: 'BRL' }, origin: { xcod: 'external_id=xid-hot-1' } },
      } }),
    });
    expect(r.statusCode).toBeLessThan(300);
    const u = (await payloadOf(acc.orgId, 'Purchase')).user_data;
    expect(u.ph).toEqual([sha('5511999990000')]);   // antes: sem o 55 → a Meta não encontrava
    expect(u.country).toEqual([sha('br')]);          // do pixel (a Hotmart não mandou)
    expect(u.em).toEqual([sha('ana.lima@gmail.com')]);
    expect(u.fn).toEqual([sha('ana')]);
    expect(u.ln).toEqual([sha('lima')]);
    expect(u.ct).toEqual([sha('saopaulo')]);
    expect(u.zp).toEqual([sha('01310100')]);
    expect(u.fbp).toBe('fb.1.1793370000000.111');
    expect(u.fbc).toBe('fb.1.1793370000000.IwAR-clique');
    expect(u.client_ip_address).toBe('189.40.1.2');
    expect(u.client_user_agent).toContain('Comprador');
    expect(u.external_id).toContain(sha('xid-hot-1'));  // o mesmo external_id dos eventos do navegador
  });

  it('visitante que volta: o InitiateCheckout leva o fbp/fbc e o e-mail que ele já deixou antes', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client);
    await collect(px.publicKey, { event: 'page_view', event_id: 'pv-v1', external_id: 'xid-volta', fbp: 'fb.1.1793370000000.222', fbc: 'fb.1.1793370000000.IwAR-volta', email: 'Joao@Exemplo.com' });
    // dias depois, outra página sem o cookie (ex.: domínio do checkout) — só o external_id
    await collect(px.publicKey, { event: 'checkout', event_id: 'ic-v1', external_id: 'xid-volta' });
    const u = (await payloadOf(acc.orgId, 'InitiateCheckout', 'ic-v1')).user_data;
    expect(u.fbp).toBe('fb.1.1793370000000.222');
    expect(u.fbc).toBe('fb.1.1793370000000.IwAR-volta');
    expect(u.em).toEqual([sha('joao@exemplo.com')]);
    expect(u.country).toEqual([sha('br')]);
    expect(u.external_id).toEqual([sha('xid-volta')]);
  });

  it('desduplicação: o navegador e o servidor mandam o MESMO event_id (a Meta conta uma vez)', async () => {
    const acc = await newAccount(env);
    const px = await newPixel(acc.client);
    const first = await collect(px.publicKey, { event: 'checkout', event_id: 'ic-dedup-1', external_id: 'xid-d' });
    const again = await collect(px.publicKey, { event: 'checkout', event_id: 'ic-dedup-1', external_id: 'xid-d' }); // reenvio (beacon + fetch)
    expect(again.json()).toMatchObject({ duplicate: true });
    expect(first.statusCode).toBeLessThan(300);
    const rows = (await env.db.query(`SELECT event_id FROM capi_outbox WHERE org_id = $1 AND event_name = 'InitiateCheckout'`, [acc.orgId])).rows;
    expect(rows).toEqual([{ event_id: 'ic-dedup-1' }]); // o mesmo id que o Pixel do navegador usou
  });
});
