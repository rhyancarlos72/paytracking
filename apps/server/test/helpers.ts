import { randomBytes } from 'node:crypto';
import { createPool, migrate, type Pool } from '@pt/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createCtx, type Ctx } from '../src/context.js';
import { MemoryMailer } from '../src/lib/mailer.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://paytracking:paytracking@localhost:5432/paytracking_test';
export const APP_URL = 'http://localhost:5173';
export const API_URL = 'http://localhost:8080';

export type FakeHandler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** fetch falso: cada teste registra respostas por padrão de URL; chamadas ficam gravadas. */
export class FakeFetch {
  calls: Array<{ url: string; method: string; body: string | null }> = [];
  private handlers: Array<{ match: RegExp; handler: FakeHandler }> = [];
  on(match: RegExp, handler: FakeHandler) {
    this.handlers.unshift({ match, handler });
    return this;
  }
  reset() {
    this.calls = [];
    this.handlers = [];
  }
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body == null ? null : typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    this.calls.push({ url: url.href, method: init?.method ?? 'GET', body });
    const h = this.handlers.find((x) => x.match.test(url.href));
    if (!h) throw new Error(`fetch não mockado: ${url.href}`);
    return h.handler(url, init);
  }) as typeof fetch;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface TestEnv {
  app: FastifyInstance;
  ctx: Ctx;
  db: Pool;
  fake: FakeFetch;
  mailer: MemoryMailer;
  now: { value: Date };
  close(): Promise<void>;
}

export async function setup(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const admin = createPool(TEST_DB.replace(/\/[^/]+$/, '/postgres'), 1);
  const dbName = `pt_test_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = TEST_DB.replace(/\/[^/]+$/, `/${dbName}`);
  const db = createPool(url, 10);
  await migrate(db, undefined, () => undefined);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    APP_URL,
    PUBLIC_API_URL: API_URL,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    META_APP_ID: '123', META_APP_SECRET: 'appsecret',
    WOOVI_APP_ID: 'woovi-app', WOOVI_WEBHOOK_SECRET: 'woovi-secret',
    PLATFORM_ADMIN_EMAILS: 'root@paytracking.test',
    TRUST_PROXY: 'true',
    ...overrides,
  });
  const fake = new FakeFetch();
  const mailer = new MemoryMailer();
  const now = { value: new Date() };
  const silent = { info() {}, warn() {}, error() {} };
  const ctx = createCtx(config, db, { fetch: fake.fetch, mailer, log: silent, now: () => now.value });
  const app = await buildApp(ctx);
  return {
    app, ctx, db, fake, mailer, now,
    async close() {
      await app.close();
      await db.end();
      const a = createPool(TEST_DB.replace(/\/[^/]+$/, '/postgres'), 1);
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Cliente HTTP com cookie de sessão. */
export class Client {
  cookie = '';
  /** cada cliente simula um IP público diferente (via proxy confiável) */
  ip = `200.${(seq * 7) % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  constructor(private readonly env: TestEnv) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.env.app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: APP_URL } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        'x-forwarded-for': this.ip,
        ...headers,
      },
    });
    const set = res.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of cookies) if (c.startsWith('pt_session=')) this.cookie = c.split(';')[0]!;
    let data: any = null;
    try { data = res.json(); } catch { data = res.body; }
    return { status: res.statusCode, data, headers: res.headers };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  del = (url: string, body?: unknown) => this.req('DELETE', url, body);
}

let seq = 0;
export async function newAccount(env: TestEnv, email = `user${++seq}_${randomBytes(3).toString('hex')}@test.com`) {
  const c = new Client(env);
  const r = await c.post('/v1/auth/signup', { email, password: 'SenhaForte123', name: 'Teste', orgName: `Org ${email}` });
  if (r.status !== 201) throw new Error(`signup falhou: ${JSON.stringify(r.data)}`);
  const me = await c.get('/v1/auth/me');
  return { client: c, email, orgId: me.data.org.id as string, userId: me.data.user.id as string };
}

export async function newPixel(c: Client, over: Record<string, unknown> = {}) {
  const r = await c.post('/v1/pixels', {
    name: 'Pixel Teste', metaPixelId: '1234567890', capiToken: 'EAAG-token-de-teste-123456', currency: 'BRL', country: 'BR', ...over,
  });
  if (r.status !== 201) throw new Error(`pixel falhou: ${JSON.stringify(r.data)}`);
  return r.data.pixel;
}

export async function newIntegration(c: Client, provider: string, over: Record<string, unknown> = {}) {
  const r = await c.post('/v1/integrations', { provider, ...over });
  if (r.status !== 201) throw new Error(`integração falhou: ${JSON.stringify(r.data)}`);
  return r.data as { integration: any; token: string; webhookUrl: string };
}

/** Faz a Meta CAPI responder com sucesso (events_received=1). */
export function metaOk(fake: FakeFetch) {
  fake.on(/graph\.facebook\.com\/v[\d.]+\/\d+\/events/, () => json(200, { events_received: 1, fbtrace_id: 'TRACE' }));
}

/** Confirma o e-mail da conta pelo link enviado (como a pessoa faria). */
export async function verifyEmail(env: TestEnv, c: Client, email: string) {
  const mail = env.mailer.sent.filter((m) => m.to === email && m.subject.includes('Confirme')).at(-1)!;
  const token = /token=([\w-]+)/.exec(mail.text)![1]!;
  const r = await c.post('/v1/auth/verify-email', { token });
  if (r.status !== 200) throw new Error('verificação falhou');
}

/** Conta do dono da plataforma (e-mail em PLATFORM_ADMIN_EMAILS) já confirmada. */
export async function newPlatformAdmin(env: TestEnv) {
  const acc = await newAccount(env, 'root@paytracking.test');
  await verifyEmail(env, acc.client, acc.email);
  return acc;
}
