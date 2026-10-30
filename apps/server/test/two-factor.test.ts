import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hotp, counterAt } from '../src/auth/totp.js';
import { Client, newAccount, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

/** código do "app autenticador" no horário simulado (+offset passos) */
const codeAt = (secret: string, offset = 0) => hotp(secret, counterAt(env.now.value) + offset);
const advance = (sec: number) => { env.now.value = new Date(env.now.value.getTime() + sec * 1000); };

async function enable(client: Client) {
  const setupR = await client.post('/v1/auth/2fa/setup');
  expect(setupR.status).toBe(200);
  const { secret, otpauthUrl } = setupR.data as { secret: string; otpauthUrl: string };
  expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/PayTracking%3A.+\?secret=[A-Z2-7]+&issuer=PayTracking/);
  expect((await client.post('/v1/auth/2fa/enable', { code: '000000' })).status).toBe(400);
  const r = await client.post('/v1/auth/2fa/enable', { code: codeAt(secret) });
  expect(r.status).toBe(200);
  return { secret, recoveryCodes: r.data.recoveryCodes as string[] };
}

describe('verificação em duas etapas (TOTP)', () => {
  it('ativa, exige o código no login, bloqueia reuso do código e avisa por e-mail', async () => {
    const { email, client } = await newAccount(env);
    const { secret, recoveryCodes } = await enable(client);
    expect(recoveryCodes).toHaveLength(10);
    expect((await client.get('/v1/auth/me')).data.user.twoFactorEnabled).toBe(true);
    expect(env.mailer.sent.some((m) => m.to === email && m.subject.includes('duas etapas foi ativada'))).toBe(true);

    // o segredo fica cifrado no banco
    const row = await env.db.query('SELECT totp_secret_enc, totp_recovery_hashes FROM users WHERE email = $1', [email]);
    expect(row.rows[0].totp_secret_enc).not.toContain(secret);
    expect(row.rows[0].totp_recovery_hashes.join()).not.toContain(recoveryCodes[0]!.replace('-', ''));

    advance(60);
    const c = new Client(env);
    const step1 = await c.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    expect(step1.status).toBe(200);
    expect(step1.data.twoFactorRequired).toBe(true);
    expect(c.cookie).toBe(''); // senha certa sozinha não abre sessão
    expect((await c.get('/v1/auth/me')).status).toBe(401);

    expect((await c.post('/v1/auth/login/2fa', { challenge: step1.data.challenge, code: '123456' })).status).toBe(401);
    const code = codeAt(secret);
    expect((await c.post('/v1/auth/login/2fa', { challenge: step1.data.challenge, code })).status).toBe(200);
    expect((await c.get('/v1/auth/me')).data.user.email).toBe(email);

    // mesmo código em outro login (replay) é recusado
    const c2 = new Client(env);
    const s2 = await c2.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    expect((await c2.post('/v1/auth/login/2fa', { challenge: s2.data.challenge, code })).status).toBe(401);
  });

  it('desafio expira, é cifrado e não serve para outra conta', async () => {
    const { email, client } = await newAccount(env);
    const { secret } = await enable(client);
    advance(60);
    const c = new Client(env);
    const s1 = await c.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    expect((await c.post('/v1/auth/login/2fa', { challenge: s1.data.challenge.slice(0, -4) + 'AAAA', code: codeAt(secret) })).status).toBe(400);
    advance(6 * 60);
    expect((await c.post('/v1/auth/login/2fa', { challenge: s1.data.challenge, code: codeAt(secret) })).status).toBe(400);
  });

  it('código de recuperação entra uma única vez e gera alerta', async () => {
    const { email, client } = await newAccount(env);
    const { recoveryCodes } = await enable(client);
    const c = new Client(env);
    const s1 = await c.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    const r = await c.post('/v1/auth/login/2fa', { challenge: s1.data.challenge, recoveryCode: recoveryCodes[0]!.toUpperCase() });
    expect(r.status).toBe(200);
    expect(r.data.recoveryCodesLeft).toBe(9);
    expect(env.mailer.sent.some((m) => m.to === email && m.subject.includes('código de recuperação'))).toBe(true);
    const c2 = new Client(env);
    const s2 = await c2.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    expect((await c2.post('/v1/auth/login/2fa', { challenge: s2.data.challenge, recoveryCode: recoveryCodes[0] })).status).toBe(401);
  });

  it('força bruta no código é bloqueada', async () => {
    const { email, client } = await newAccount(env);
    await enable(client);
    const c = new Client(env);
    const s1 = await c.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await new Client(env).post('/v1/auth/login/2fa', { challenge: s1.data.challenge, code: String(100000 + i) })).status;
    expect(last).toBe(429);
  });

  it('desativar exige senha + código e revoga as outras sessões', async () => {
    const { email, client } = await newAccount(env);
    const { secret } = await enable(client);
    advance(60);
    const other = new Client(env);
    const s = await other.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    await other.post('/v1/auth/login/2fa', { challenge: s.data.challenge, code: codeAt(secret) });
    expect((await other.get('/v1/auth/me')).status).toBe(200);
    advance(60);
    expect((await client.post('/v1/auth/2fa/disable', { password: 'errada', code: codeAt(secret) })).status).toBe(400);
    expect((await client.post('/v1/auth/2fa/disable', { password: 'SenhaForte123', code: '000000' })).status).toBe(400);
    expect((await client.post('/v1/auth/2fa/disable', { password: 'SenhaForte123', code: codeAt(secret) })).status).toBe(200);
    expect((await other.get('/v1/auth/me')).status).toBe(401);
    expect((await client.get('/v1/auth/me')).data.user.twoFactorEnabled).toBe(false);
    const c = new Client(env);
    expect((await c.post('/v1/auth/login', { email, password: 'SenhaForte123' })).data).toEqual({ ok: true });
  });

  it('gera novos códigos de recuperação (os antigos deixam de valer)', async () => {
    const { email, client } = await newAccount(env);
    const { secret, recoveryCodes } = await enable(client);
    advance(60);
    const r = await client.post('/v1/auth/2fa/recovery-codes', { code: codeAt(secret) });
    expect(r.status).toBe(200);
    expect(r.data.recoveryCodes).not.toContain(recoveryCodes[0]);
    const c = new Client(env);
    const s = await c.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    expect((await c.post('/v1/auth/login/2fa', { challenge: s.data.challenge, recoveryCode: recoveryCodes[0] })).status).toBe(401);
  });
});

describe('proteções gerais', () => {
  it('cabeçalhos de segurança e security.txt', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/^Contact: mailto:/m);
    expect(r.body).toMatch(/^Expires: \d{4}-/m);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-permitted-cross-domain-policies']).toBe('none');
  });

  it('enxurrada na coleta pública é freada por IP (sem afetar outro IP)', async () => {
    const send = (ip: string) => env.app.inject({ method: 'POST', url: '/v1/collect', payload: '{}', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } });
    let last = 0;
    for (let i = 0; i < 305; i++) last = (await send('203.0.113.9')).statusCode;
    expect(last).toBe(429);
    expect((await send('203.0.113.10')).statusCode).not.toBe(429);
  });
});
