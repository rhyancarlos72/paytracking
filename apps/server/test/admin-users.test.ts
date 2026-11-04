import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, newAccount, newPixel, newPlatformAdmin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Client;
beforeAll(async () => { env = await setup(); admin = (await newPlatformAdmin(env)).client; });
afterAll(async () => { await env.close(); });

const login = (email: string, password = 'SenhaForte123', ip = '189.40.10.1') =>
  env.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password }, headers: { origin: 'http://localhost:5173', 'x-forwarded-for': ip } });

describe('Admin → Usuários', () => {
  it('mostra uso e pagamento de cada conta SEM expor o pixel; só o dono da plataforma acessa', async () => {
    const user = await newAccount(env);
    const px = await newPixel(user.client, { name: 'Pixel Super Secreto' });
    await env.db.query(`INSERT INTO billing_charges(org_id, correlation_id, amount_minor, status, paid_at, expires_at) VALUES ($1, 'corr-adm-1', 4700, 'paid', now(), now() + interval '1 day')`, [user.orgId]);
    expect((await user.client.get('/v1/admin/users')).status).toBe(403);

    const r = await admin.get(`/v1/admin/users?q=${encodeURIComponent(user.email)}`);
    expect(r.status).toBe(200);
    const u = r.data.users[0];
    expect(u).toMatchObject({ email: user.email, emailVerified: false, twoFactor: false, blocked: null });
    expect(u.billing).toMatchObject({ paidCount: 1, paidTotalMinor: '4700' });
    expect(u.usage).toMatchObject({ pixels: 1, pixelsActive: 1, metaConnected: false });
    const body = JSON.stringify(r.data) + JSON.stringify((await admin.get(`/v1/admin/users/${user.userId}`)).data);
    for (const secret of [px.id, px.publicKey, 'Pixel Super Secreto', '1234567890', 'EAAG']) expect(body, secret).not.toContain(secret);
    expect((await admin.get('/v1/admin/users?filter=paid')).data.users.map((x: any) => x.id)).toContain(user.userId);
  });

  it('sinais para conferir: senhas erradas e várias contas no mesmo IP', async () => {
    const alvo = await newAccount(env);
    for (let i = 0; i < 5; i++) await login(alvo.email, 'SenhaErrada123', '200.1.1.' + i);
    // três contas entrando do mesmo IP
    const a = await newAccount(env); const b = await newAccount(env); const c = await newAccount(env);
    for (const x of [a, b, c]) expect((await login(x.email, 'SenhaForte123', '177.20.30.40')).statusCode).toBe(200);
    const risk = (await admin.get('/v1/admin/users?filter=risk')).data.users;
    const find = (id: string) => risk.find((x: any) => x.id === id);
    expect(find(alvo.userId).flags.map((f: any) => f.code)).toContain('failed_logins');
    expect(find(a.userId).flags.map((f: any) => f.code)).toContain('shared_ip');
    // IP interno (proxy da hospedagem/rede local) não vira sinal, mesmo com várias contas
    const d1 = await newAccount(env); const d2 = await newAccount(env); const d3 = await newAccount(env);
    for (const x of [d1, d2, d3]) await login(x.email, 'SenhaForte123', '10.0.0.5');
    const all = (await admin.get('/v1/admin/users')).data.users;
    expect(all.find((x: any) => x.id === d1.userId).flags.map((f: any) => f.code)).not.toContain('shared_ip');
    // detalhe: atividade com IP mascarado
    const d = (await admin.get(`/v1/admin/users/${a.userId}`)).data;
    expect(d.activity.some((x: any) => x.action === 'auth.login' && x.ip === '177.20.•.•')).toBe(true);
    expect(JSON.stringify(d)).not.toContain('177.20.30.40');
  });

  it('bloquear: derruba as sessões na hora e impede novo login; desbloquear libera', async () => {
    const u = await newAccount(env);
    expect((await u.client.get('/v1/auth/me')).status).toBe(200);
    expect((await admin.post(`/v1/admin/users/${u.userId}/block`, { blocked: true, reason: 'fraude no teste grátis' })).status).toBe(200);
    expect((await u.client.get('/v1/auth/me')).status).toBe(401);           // sessão aberta caiu
    const again = await login(u.email);
    expect(again.statusCode).toBe(403);                                     // senha certa, mas bloqueado
    expect(again.json().error.message).toContain('Acesso bloqueado');
    expect((await admin.get(`/v1/admin/users?filter=blocked`)).data.users.map((x: any) => x.id)).toContain(u.userId);
    // não dá para bloquear a si mesmo nem outro admin
    const me = (await admin.get('/v1/auth/me')).data.user.id;
    expect((await admin.post(`/v1/admin/users/${me}/block`, { blocked: true })).status).toBe(400);
    await admin.post(`/v1/admin/users/${u.userId}/block`, { blocked: false });
    expect((await login(u.email)).statusCode).toBe(200);
  });
});
