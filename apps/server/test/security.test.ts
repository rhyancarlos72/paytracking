import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, APP_URL, Client, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('autenticação', () => {
  it('login, sessão, logout e senha errada', async () => {
    const { email } = await newAccount(env);
    const c = new Client(env);
    expect((await c.post('/v1/auth/login', { email, password: 'errada' })).status).toBe(401);
    expect((await c.post('/v1/auth/login', { email, password: 'SenhaForte123' })).status).toBe(200);
    expect((await c.get('/v1/auth/me')).data.user.email).toBe(email);
    await c.post('/v1/auth/logout');
    expect((await c.get('/v1/auth/me')).status).toBe(401);
  });

  it('força bruta por e-mail é bloqueada mesmo trocando de IP', async () => {
    const { email } = await newAccount(env);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await new Client(env).post('/v1/auth/login', { email, password: 'errada' + i })).status;
    expect(last).toBe(429);
  });

  it('usuário migrado com hash $2y$ do PHP entra sem trocar a senha (e o hash é atualizado)', async () => {
    const legacy = bcrypt.hashSync('SenhaLegada99', 10).replace(/^\$2a\$/, '$2y$');
    await env.db.query(`INSERT INTO users(email, password_hash) VALUES ('legado@x.com', $1)`, [legacy]);
    const u = await env.db.query(`SELECT id FROM users WHERE email = 'legado@x.com'`);
    const o = await env.db.query(`INSERT INTO organizations(name, plan_status, plan_expires_at) VALUES ('Leg', 'active', now() + interval '10 days') RETURNING id`);
    await env.db.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')`, [o.rows[0].id, u.rows[0].id]);
    const c = new Client(env);
    expect((await c.post('/v1/auth/login', { email: 'legado@x.com', password: 'SenhaLegada99' })).status).toBe(200);
    const h = await env.db.query(`SELECT password_hash FROM users WHERE email = 'legado@x.com'`);
    expect(h.rows[0].password_hash.startsWith('$2a$12$') || h.rows[0].password_hash.startsWith('$2b$12$')).toBe(true);
  });

  it('recuperação de senha revoga sessões; token é de uso único; resposta não revela se o e-mail existe', async () => {
    const { email, client } = await newAccount(env);
    expect((await new Client(env).post('/v1/auth/forgot-password', { email: 'naoexiste@x.com' })).status).toBe(200);
    await new Client(env).post('/v1/auth/forgot-password', { email });
    const mail = env.mailer.sent.filter((m) => m.to === email && m.subject.includes('Redefinição')).at(-1)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    const anon = new Client(env);
    expect((await anon.post('/v1/auth/reset-password', { token, password: 'fraca' })).status).toBe(400);
    expect((await anon.post('/v1/auth/reset-password', { token, password: 'NovaSenha12345' })).status).toBe(200);
    expect((await anon.post('/v1/auth/reset-password', { token, password: 'OutraSenha12345' })).status).toBe(400);
    expect((await client.get('/v1/auth/me')).status).toBe(401); // sessão antiga revogada
    expect((await new Client(env).post('/v1/auth/login', { email, password: 'NovaSenha12345' })).status).toBe(200);
  });

  it('verificação de e-mail e troca de senha', async () => {
    const { email, client } = await newAccount(env);
    const mail = env.mailer.sent.filter((m) => m.to === email && m.subject.includes('Confirme')).at(-1)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect((await client.post('/v1/auth/verify-email', { token })).status).toBe(200);
    expect((await client.get('/v1/auth/me')).data.user.emailVerified).toBe(true);
    const other = new Client(env);
    await other.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    const ch = await client.post('/v1/auth/change-password', { currentPassword: 'SenhaForte123', newPassword: 'Trocada123456' });
    expect(ch.data.revokedSessions).toBe(1);
    expect((await other.get('/v1/auth/me')).status).toBe(401);
    expect((await client.get('/v1/auth/me')).status).toBe(200);
  });

  it('CSRF: escrita sem Origin do painel é recusada', async () => {
    const { client } = await newAccount(env);
    const r = await client.req('POST', '/v1/pixels', { name: 'x' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe('bad_origin');
  });
});

describe('cenários 1/2 — isolamento multi-tenant', () => {
  it('usuário só vê os próprios dados e não lê/altera recursos de outra organização', async () => {
    const a = await newAccount(env);
    const b = await newAccount(env);
    const pa = await newPixel(a.client, { productIds: ['A-1'] });
    const ib = await newIntegration(b.client, 'checkout');
    await env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify({ event: 'paid', transaction_id: 'B-1', value: 1 }), headers: { 'content-type': 'application/json', authorization: `Bearer ${ib.token}` } });
    const payB = (await env.db.query(`SELECT id FROM payments WHERE transaction_id = 'B-1'`)).rows[0].id;

    expect((await a.client.get('/v1/pixels')).data.pixels).toHaveLength(1);
    expect((await b.client.get('/v1/pixels')).data.pixels).toHaveLength(0);
    // leitura cruzada
    expect((await a.client.get(`/v1/payments/${payB}`)).status).toBe(404);
    expect((await a.client.get('/v1/payments?preset=today')).data.total).toBe(0);
    expect((await a.client.get('/v1/integrations')).data.integrations).toHaveLength(0);
    // escrita cruzada
    expect((await b.client.put(`/v1/pixels/${pa.id}`, { name: 'hack', metaPixelId: '999999999' })).status).toBe(404);
    expect((await b.client.del(`/v1/pixels/${pa.id}`)).status).toBe(404);
    expect((await b.client.post(`/v1/pixels/${pa.id}/toggle`)).status).toBe(404);
    expect((await b.client.patch(`/v1/integrations/${ib.integration.id}`, { name: 'ok' })).status).toBe(200);
    expect((await a.client.patch(`/v1/integrations/${ib.integration.id}`, { name: 'hack' })).status).toBe(404);
    expect((await a.client.post(`/v1/integrations`, { provider: 'checkout', defaultPixelId: pa.id })).status).toBe(201);
    expect((await b.client.post(`/v1/integrations`, { provider: 'checkout', defaultPixelId: pa.id })).status).toBe(400);
    // segredos nunca saem da API
    const list = JSON.stringify((await a.client.get('/v1/pixels')).data);
    expect(list).not.toContain('EAAG-token');
  });

  it('pixel-config com chave pública só resolve produtos da própria organização (P-02b)', async () => {
    const a = await newAccount(env);
    const b = await newAccount(env);
    const pa = await newPixel(a.client, { productIds: ['DUP-9'] });
    const pb = await newPixel(b.client, { productIds: ['DUP-9'] });
    const r = await env.app.inject({ method: 'GET', url: `/v1/pixel-config?produto_id=DUP-9&key=${pa.publicKey}` });
    expect(r.json().public_key).toBe(pa.publicKey);
    const r2 = await env.app.inject({ method: 'GET', url: `/v1/pixel-config?produto_id=DUP-9&key=${pb.publicKey}` });
    expect(r2.json().public_key).toBe(pb.publicKey);
    // URL legada sem chave: produto ambíguo entre organizações não é entregue a ninguém
    expect((await env.app.inject({ method: 'GET', url: '/api/pixel-config.php?produto_id=DUP-9' })).statusCode).toBe(404);
  });
});

describe('cenário 17 — permissões por papel', () => {
  it('viewer lê mas não altera integrações; analyst reprocessa; admin altera', async () => {
    const owner = await newAccount(env);
    const viewer = await newAccount(env);
    await owner.client.post('/v1/org/invitations', { email: viewer.email, role: 'viewer' });
    const mail = env.mailer.sent.filter((m) => m.to === viewer.email && m.subject.startsWith('Convite')).at(-1)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect((await viewer.client.post('/v1/invitations/accept', { token })).status).toBe(200);
    expect((await viewer.client.get('/v1/auth/me')).data.role).toBe('viewer');
    const integ = await newIntegration(owner.client, 'checkout');
    expect((await viewer.client.get('/v1/integrations')).data.integrations).toHaveLength(1);
    expect((await viewer.client.patch(`/v1/integrations/${integ.integration.id}`, { active: false })).status).toBe(403);
    expect((await viewer.client.post('/v1/integrations', { provider: 'checkout' })).status).toBe(403);
    expect((await viewer.client.post('/v1/events/requeue', { all: true })).status).toBe(403);
    expect((await viewer.client.post('/v1/org/invitations', { email: 'x@y.com', role: 'admin' })).status).toBe(403);
    await owner.client.patch(`/v1/org/members/${viewer.userId}`, { role: 'analyst' });
    expect((await viewer.client.post('/v1/events/requeue', { all: true })).status).toBe(200);
    expect((await viewer.client.patch(`/v1/integrations/${integ.integration.id}`, { active: false })).status).toBe(403);
  });

  it('convite só pode ser aceito pelo e-mail convidado', async () => {
    const owner = await newAccount(env);
    const intruder = await newAccount(env);
    await owner.client.post('/v1/org/invitations', { email: 'alvo@x.com', role: 'admin' });
    const mail = env.mailer.sent.filter((m) => m.to === 'alvo@x.com').at(-1)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect((await intruder.client.post('/v1/invitations/accept', { token })).status).toBe(403);
  });

  it('admin da plataforma é o único com acesso a /v1/admin', async () => {
    const normal = await newAccount(env);
    expect((await normal.client.get('/v1/admin/orgs')).status).toBe(403);
    const root = await newAccount(env, 'root@paytracking.test');
    expect((await root.client.get('/v1/admin/orgs')).status).toBe(200);
  });

  it('assinatura expirada bloqueia o painel (402) mas não o financeiro', async () => {
    const acc = await newAccount(env);
    await env.db.query(`UPDATE organizations SET plan_expires_at = now() - interval '1 day' WHERE id = $1`, [acc.orgId]);
    expect((await acc.client.get('/v1/pixels')).status).toBe(402);
    expect((await acc.client.get('/v1/billing')).status).toBe(200);
  });
});

describe('assinatura Woovi — renovação idempotente (P-07)', () => {
  it('webhook repetido e evento duplicado renovam só uma vez', async () => {
    const acc = await newAccount(env);
    env.fake.on(/openpix\.com\.br\/api\/v1\/charge/, async (_u, init) => {
      const b = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ charge: { correlationID: b.correlationID, identifier: 'id1', brCode: '000201...', value: b.value } }), { status: 200 });
    });
    const ch = await acc.client.post('/v1/billing/charge');
    expect(ch.status).toBe(200);
    const corr = ch.data.charge.correlation_id;
    const before = (await env.db.query('SELECT plan_expires_at FROM organizations WHERE id = $1', [acc.orgId])).rows[0].plan_expires_at;
    const { wooviSignature } = await import('../src/billing/routes.js');
    const send = (event: string) => {
      const raw = JSON.stringify({ event, charge: { correlationID: corr, status: 'COMPLETED', value: 4700 } });
      return env.app.inject({ method: 'POST', url: '/v1/webhooks/woovi', payload: raw, headers: { 'content-type': 'application/json', 'x-webhook-signature': wooviSignature(raw, 'woovi-secret') } });
    };
    expect((await send('OPENPIX:CHARGE_COMPLETED')).json()).toMatchObject({ renewed: true });
    expect((await send('OPENPIX:CHARGE_COMPLETED')).json()).toMatchObject({ duplicate: true });
    expect((await send('OPENPIX:TRANSACTION_RECEIVED')).json()).toMatchObject({ duplicate: true });
    const after = (await env.db.query('SELECT plan_status, plan_expires_at FROM organizations WHERE id = $1', [acc.orgId])).rows[0];
    const days = (after.plan_expires_at.getTime() - before.getTime()) / 86_400_000;
    expect(after.plan_status).toBe('active');
    expect(Math.round(days)).toBe(30);
    const bad = await env.app.inject({ method: 'POST', url: '/v1/webhooks/woovi', payload: '{}', headers: { 'content-type': 'application/json', 'x-webhook-signature': 'x' } });
    expect(bad.statusCode).toBe(401);
  });
});

describe('cenário 19 — banco indisponível', () => {
  it('healthz responde 503 sem derrubar o processo', async () => {
    const { createPool } = await import('@pt/db');
    const { buildApp } = await import('../src/app.js');
    const { createCtx } = await import('../src/context.js');
    const broken = createPool('postgres://x:y@127.0.0.1:1/nada', 1);
    const app = await buildApp(createCtx(env.ctx.config, broken, { log: env.ctx.log }));
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(503);
    const w = await app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: '{}', headers: { 'content-type': 'application/json', authorization: 'Bearer itk_x', origin: APP_URL } });
    expect(w.statusCode).toBe(500); // gateway reenviará; nada foi perdido
    await app.close();
    await broken.end();
    void API_URL;
  });
});

describe('IP do cliente atrás de proxy (TRUST_PROXY=1)', () => {
  it('início do X-Forwarded-For escrito pelo cliente é ignorado; vale o IP acrescentado pelo proxy', async () => {
    const e = await setup({ TRUST_PROXY: '1' });
    try {
      const { email } = await newAccount(e);
      const c = new Client(e);
      c.ip = '6.6.6.6, 200.10.20.30'; // cliente forja "6.6.6.6"; o proxy acrescenta o IP real
      expect((await c.post('/v1/auth/login', { email, password: 'SenhaForte123' })).status).toBe(200);
      const s = await c.get('/v1/auth/sessions');
      expect(s.data.sessions.find((x: { current: boolean }) => x.current).ip).toBe('200.10.20.30');
    } finally {
      await e.close();
    }
  });
});
