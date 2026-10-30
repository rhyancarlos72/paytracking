import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wooviSignature } from '../src/billing/routes.js';
import { Client, json, newAccount, newPixel, setup, type TestEnv } from './helpers.js';

const KEY = 'pt_px_plataforma_teste';
let env: TestEnv;
let platformPixelId = '';
beforeAll(async () => {
  env = await setup({ PLATFORM_PIXEL_KEY: KEY, PLATFORM_PIXEL_ID: '2215202246010798' });
  // a conta do dono do PayTracking, com o pixel da plataforma
  const owner = await newAccount(env);
  const px = await newPixel(owner.client, { name: 'PayTracking (plataforma)' });
  await env.db.query('UPDATE pixels SET public_key = $1 WHERE id = $2', [KEY, px.id]);
  platformPixelId = px.id;
});
afterAll(async () => { await env.close(); });

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const FBP = 'fb.1.1793370000000.1234567890';
const FBC = 'fb.1.1793370000000.IwAR0abcDEFghiJKL';
const outbox = async (eventName: string) => (await env.db.query(
  'SELECT event_id, payload FROM capi_outbox WHERE pixel_id = $1 AND event_name = $2 ORDER BY id', [platformPixelId, eventName])).rows;

describe('pixel da própria plataforma (marketing do PayTracking)', () => {
  let email = '';
  let orgId = '';
  let userId = '';
  let client: Client;

  it('cadastro: guarda a origem (cookies da Meta, UTMs) e envia Lead pela Conversions API', async () => {
    client = new Client(env);
    email = `cliente_${Date.now()}@exemplo.com`;
    const r = await client.req('POST', '/v1/auth/signup',
      { email, password: 'SenhaForte123', name: 'Maria Silva', utms: { utm_source: 'facebook', utm_campaign: 'Campanha Black', evil: '<x>' } },
      { cookie: `_fbp=${FBP}; _fbc=${FBC}` });
    expect(r.status).toBe(201);
    const me = (await client.get('/v1/auth/me')).data;
    orgId = me.org.id; userId = me.user.id;
    const attr = (await env.db.query('SELECT fbp, fbc, utm_source, utm_campaign FROM signup_attribution WHERE user_id = $1', [userId])).rows[0];
    expect(attr).toEqual({ fbp: FBP, fbc: FBC, utm_source: 'facebook', utm_campaign: 'Campanha Black' });
    const lead = (await outbox('Lead')).find((x) => x.event_id === `pt_signup_${userId}`);
    expect(lead).toBeTruthy();
    expect(lead.payload.user_data.em).toEqual([sha(email)]); // e-mail só em hash
    expect(lead.payload.user_data.fbp).toBe(FBP);
    expect(lead.payload.user_data.fbc).toBe(FBC);
    expect(JSON.stringify(lead.payload)).not.toContain(email);
  });

  it('assinatura paga: Purchase com o valor e os identificadores do cadastro (uma vez só)', async () => {
    env.fake.on(/api\/v1\/charge/, (_u, init) => {
      const b = JSON.parse(String(init?.body));
      return json(200, { charge: { correlationID: b.correlationID, identifier: 'id1', brCode: '000201', value: b.value } });
    });
    const ch = await client.post('/v1/billing/charge');
    expect(ch.status).toBe(200);
    const corr = ch.data.charge.correlation_id;
    const send = () => {
      const raw = JSON.stringify({ event: 'OPENPIX:CHARGE_COMPLETED', charge: { correlationID: corr, status: 'COMPLETED', value: 4700 } });
      return env.app.inject({ method: 'POST', url: '/v1/webhooks/woovi', payload: raw, headers: { 'content-type': 'application/json', 'x-webhook-signature': wooviSignature(raw, 'woovi-secret') } });
    };
    expect((await send()).json()).toMatchObject({ renewed: true });
    expect((await send()).json()).toMatchObject({ duplicate: true });
    const purchases = (await outbox('Purchase')).filter((x) => x.event_id === `pt_billing_${corr}`);
    expect(purchases).toHaveLength(1);
    const p = purchases[0].payload;
    expect(p.custom_data).toMatchObject({ value: 47, currency: 'BRL', order_id: corr, content_ids: ['paytracking-mensal'], utm_campaign: 'Campanha Black' });
    expect(p.user_data).toMatchObject({ em: [sha(email)], fbp: FBP, fbc: FBC });
    expect(p.action_source).toBe('website');
    expect(orgId).toBeTruthy();
  });

  it('o pixel do navegador não é entregue fora de produção (testes/desenvolvimento)', async () => {
    expect((await new Client(env).get('/v1/public/tracking')).data).toEqual({ pixel: null, signedIn: false });
  });

  it('sem o pixel da plataforma no banco, cadastro e pagamento seguem normais e nada é enviado', async () => {
    await env.db.query('UPDATE pixels SET active = false WHERE id = $1', [platformPixelId]);
    const before = (await outbox('Lead')).length;
    const acc = await newAccount(env);
    expect(acc.orgId).toBeTruthy();
    expect((await outbox('Lead')).length).toBe(before);
    await env.db.query('UPDATE pixels SET active = true WHERE id = $1', [platformPixelId]);
  });
});
