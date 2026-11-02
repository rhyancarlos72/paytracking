import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hotp, counterAt } from '../src/auth/totp.js';
import { APP_URL, Client, json, newAccount, setup, type TestEnv, newPlatformAdmin } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup({ GOOGLE_CLIENT_ID: 'cliente.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'segredo-google' }); });
afterAll(async () => { await env.close(); });

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.assinatura`;

/** Faz o "Google" responder à troca do código com um id_token para estes dados. */
function googleReturns(over: (nonce: string) => Record<string, unknown>) {
  env.fake.reset();
  env.fake.on(/oauth2\.googleapis\.com\/token/, (_u, init) => {
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('code_verifier')).toMatch(/^[\w-]{40,}$/); // PKCE
    expect(body.get('client_secret')).toBe('segredo-google');
    return json(200, { id_token: jwt(over(nonceSeen)) });
  });
}
let nonceSeen = '';

/** Inicia o login (como o botão) e devolve o state e o cookie do fluxo. */
async function start(c: Client) {
  const r = await c.get('/v1/auth/google/start?voltar=/vendas');
  expect(r.status).toBe(302);
  const loc = new URL(String(r.headers.location));
  expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:8080/v1/auth/google/callback');
  nonceSeen = loc.searchParams.get('nonce')!;
  const set = ([] as string[]).concat(r.headers['set-cookie'] as string | string[]);
  const flowCookie = set.find((x) => x.startsWith('pt_google='))!.split(';')[0]!;
  expect(set.find((x) => x.startsWith('pt_google='))).toMatch(/HttpOnly/i);
  return { state: loc.searchParams.get('state')!, flowCookie };
}

async function callback(c: Client, flowCookie: string, state: string) {
  return c.req('GET', `/v1/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, undefined, { cookie: flowCookie });
}

const claims = (email: string, sub: string, extra: Record<string, unknown> = {}) => (nonce: string) => ({
  iss: 'https://accounts.google.com', aud: 'cliente.apps.googleusercontent.com', exp: Math.floor(env.now.value.getTime() / 1000) + 600,
  nonce, sub, email, email_verified: true, name: 'Maria Google', ...extra,
});

describe('login com Google', () => {
  it('informa ao painel que o Google está disponível', async () => {
    expect((await new Client(env).get('/v1/auth/providers')).data).toEqual({ google: true });
  });

  it('cria a conta no primeiro acesso, já com e-mail verificado, e entra', async () => {
    const c = new Client(env);
    const { state, flowCookie } = await start(c);
    googleReturns(claims('nova.google@exemplo.com', 'sub-novo'));
    const r = await callback(c, flowCookie, state);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`${APP_URL}/?bem-vindo=1`);
    c.cookie = ([] as string[]).concat(r.headers['set-cookie'] as string[]).find((x) => x.startsWith('pt_session='))!.split(';')[0]!;
    const me = await c.get('/v1/auth/me');
    expect(me.data.user.email).toBe('nova.google@exemplo.com');
    expect(me.data.user.emailVerified).toBe(true);
    expect(me.data.role).toBe('owner');
  });

  it('vincula a conta existente com o mesmo e-mail e avisa por e-mail; volta para a página pedida', async () => {
    const { email } = await newAccount(env);
    const c = new Client(env);
    const { state, flowCookie } = await start(c);
    googleReturns(claims(email, 'sub-existente'));
    const r = await callback(c, flowCookie, state);
    expect(r.headers.location).toBe(`${APP_URL}/vendas`);
    expect(env.mailer.sent.some((m) => m.to === email && m.subject.includes('Google foi conectado'))).toBe(true);
    const u = await env.db.query('SELECT google_sub FROM users WHERE email = $1', [email]);
    expect(u.rows[0].google_sub).toBe('sub-existente');
  });

  it('recusa: state trocado, sem cookie do fluxo, nonce/aud errados, e-mail não verificado', async () => {
    const c = new Client(env);
    let f = await start(c);
    googleReturns(claims('x1@exemplo.com', 's1'));
    expect((await callback(c, f.flowCookie, 'state-de-outro')).headers.location).toContain('erro=google_expirou');
    f = await start(c);
    expect((await callback(c, '', f.state)).headers.location).toContain('erro=google_expirou');
    f = await start(c);
    googleReturns((n) => ({ ...claims('x2@exemplo.com', 's2')(n), nonce: 'outro' }));
    expect((await callback(c, f.flowCookie, f.state)).headers.location).toContain('erro=google_falhou');
    f = await start(c);
    googleReturns((n) => ({ ...claims('x3@exemplo.com', 's3')(n), aud: 'outro-app' }));
    expect((await callback(c, f.flowCookie, f.state)).headers.location).toContain('erro=google_falhou');
    f = await start(c);
    googleReturns(claims('x4@exemplo.com', 's4', { email_verified: false }));
    expect((await callback(c, f.flowCookie, f.state)).headers.location).toContain('erro=google_email_nao_verificado');
    const n = await env.db.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'x_@exemplo.com'`);
    expect(n.rows[0].n).toBe(0);
  });

  it('e-mail já vinculado a OUTRA conta Google não é sequestrado', async () => {
    const c = new Client(env);
    let f = await start(c);
    googleReturns(claims('dono@exemplo.com', 'sub-dono'));
    await callback(c, f.flowCookie, f.state);
    f = await start(c);
    googleReturns(claims('dono@exemplo.com', 'sub-intruso'));
    expect((await callback(c, f.flowCookie, f.state)).headers.location).toContain('erro=google_outra_conta');
  });

  it('com verificação em duas etapas, o Google não pula o código', async () => {
    const { email, client } = await newAccount(env);
    const { secret } = (await client.post('/v1/auth/2fa/setup')).data;
    await client.post('/v1/auth/2fa/enable', { code: hotp(secret, counterAt(env.now.value)) });
    const c = new Client(env);
    const f = await start(c);
    googleReturns(claims(email, 'sub-2fa'));
    const r = await callback(c, f.flowCookie, f.state);
    expect(String(r.headers.location)).toMatch(/\/entrar\?voltar=%2Fvendas#desafio=/);
    expect(([] as string[]).concat((r.headers['set-cookie'] as string[]) ?? []).some((x) => x.startsWith('pt_session='))).toBe(false);
  });

  it('admin vê a URI exata para o Google Cloud e os problemas de configuração', async () => {
    const { client } = await newPlatformAdmin(env);
    const r = await client.get('/v1/admin/google');
    expect(r.status).toBe(200);
    expect(r.data.redirectUri).toBe('http://localhost:8080/v1/auth/google/callback');
    expect(r.data.jsOrigin).toBe(APP_URL);
    expect(r.data.clientIdHint).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(r.data.problems.join(' ')).toContain('GOCSPX-'); // segredo do teste não é uma chave real do Google
    expect(r.data.problems.join(' ')).toContain('endereços diferentes'); // APP_URL :5173 × API :8080 no teste
    const { client: comum } = await newAccount(env);
    expect((await comum.get('/v1/admin/google')).status).toBe(403);
  });
});
