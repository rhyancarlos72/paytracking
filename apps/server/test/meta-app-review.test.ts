import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, newAccount, newPlatformAdmin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(() => env.fake.reset());

const ALL = ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement'];
function fakeMeta(opts: { paused?: boolean; granted?: string[] } = {}) {
  env.fake.on(/oauth\/access_token/, (u) => json(200, { access_token: u.searchParams.get('grant_type') ? 'LONG' : 'SHORT', expires_in: 5_184_000 }));
  env.fake.on(/me\/permissions/, () => json(200, { data: (opts.granted ?? ALL).map((permission) => ({ permission, status: 'granted' })) }));
  env.fake.on(/me\/adaccounts/, () => json(200, { data: [{ account_id: '777', name: 'Conta', account_status: 1, currency: 'BRL', timezone_name: 'America/Sao_Paulo' }] }));
  env.fake.on(/act_777\/campaigns/, () => json(200, { data: [
    { id: '120000000000010', name: 'Ativa', status: 'ACTIVE' },
    ...(opts.paused === false ? [] : [{ id: '120000000000011', name: 'Pausada', status: 'PAUSED' }]),
  ] }));
  env.fake.on(/graph\.facebook\.com\/v[\d.]+\/120000000000011$/, () => json(200, { success: true }));
  env.fake.on(/me\/accounts/, () => json(200, { data: [{ id: '5550001', name: 'Minha Página', access_token: 'PAGE-TOKEN' }] }));
  env.fake.on(/\/5550001\?/, () => json(200, { id: '5550001', name: 'Minha Página', followers_count: 10 }));
}
async function connect(acc: Awaited<ReturnType<typeof newAccount>>) {
  const { url } = (await acc.client.post('/v1/meta/connect')).data;
  const state = new URL(url).searchParams.get('state')!;
  const r = await env.app.inject({ method: 'GET', url: `/v1/meta/callback?code=abc&state=${state}` });
  expect(r.headers.location).toContain('connected=1');
  return url as string;
}
let adminAcc: Awaited<ReturnType<typeof newPlatformAdmin>> | null = null;
const getAdmin = async () => (adminAcc ??= await newPlatformAdmin(env)); // o e-mail do dono só pode existir uma vez
const waitFor = async (fn: () => Promise<boolean>) => { const t = Date.now(); while (!(await fn()) && Date.now() - t < 3000) await new Promise((r) => setTimeout(r, 50)); };

describe('chamadas de teste para a revisão do app na Meta', () => {
  it('admin da plataforma: pede as permissões de Página e, ao conectar, faz sozinho uma chamada de cada permissão', async () => {
    const admin = await getAdmin();
    fakeMeta();
    const url = await connect(admin);
    expect(new URL(url).searchParams.get('scope')!.split(',').sort()).toEqual([...ALL].sort());
    expect(new URL(url).searchParams.get('auth_type')).toBe('rerequest'); // pergunta de novo o que foi negado antes
    await waitFor(async () => !!(await admin.client.get('/v1/admin/meta-review')).data.result);
    const d = (await admin.client.get('/v1/admin/meta-review')).data;
    expect(d.connected).toBe(true);
    expect(Object.fromEntries(d.result.calls.map((c: { permission: string; ok: boolean }) => [c.permission, c.ok]))).toEqual({ ads_read: true, ads_management: true, pages_show_list: true, pages_read_engagement: true });
    // a única escrita é o status PAUSED na campanha que JÁ estava pausada; a ativa nunca é tocada
    const posts = env.fake.calls.filter((c) => c.method === 'POST' && !/oauth/.test(c.url));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toMatch(/\/120000000000011$/);
    expect(posts[0]!.body).toContain('status=PAUSED');
    // a leitura da Página usa o token da própria Página
    const pageCall = env.fake.calls.find((c) => /\/5550001\?/.test(c.url))!;
    expect(pageCall).toBeTruthy();
  });

  it('sem campanha pausada: nenhuma escrita na conta (só leitura) e o painel explica o que fazer', async () => {
    const admin = await getAdmin();
    fakeMeta({ paused: false });
    await connect(admin);
    const r = (await admin.client.post('/v1/admin/meta-review/run')).data.result;
    expect(env.fake.calls.filter((c) => c.method === 'POST' && !/oauth/.test(c.url))).toHaveLength(0);
    const am = r.calls.find((c: { permission: string }) => c.permission === 'ads_management');
    expect(am.ok).toBe(true);
    expect(am.detail).toContain('PAUSADA');
  });

  it('permissão não marcada na janela do Facebook: aparece como falha com a orientação', async () => {
    const admin = await getAdmin();
    fakeMeta({ granted: ['ads_read', 'ads_management'] });
    await connect(admin);
    const r = (await admin.client.post('/v1/admin/meta-review/run')).data.result;
    const pages = r.calls.filter((c: { permission: string }) => c.permission.startsWith('pages_'));
    expect(pages.every((c: { ok: boolean; detail: string }) => !c.ok && /Editar acesso/.test(c.detail))).toBe(true);
  });

  it('cliente comum: o login pede só as permissões de anúncios, nada roda e o Admin é proibido', async () => {
    const acc = await newAccount(env);
    fakeMeta();
    const url = await connect(acc);
    expect(new URL(url).searchParams.get('scope')).toBe('ads_read,ads_management');
    expect(new URL(url).searchParams.get('auth_type')).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(env.fake.calls.some((c) => /me\/accounts|act_777\/campaigns/.test(c.url))).toBe(false);
    expect((await acc.client.get('/v1/admin/meta-review')).status).toBe(403);
    expect((await acc.client.post('/v1/admin/meta-review/run')).status).toBe(403);
  });

  it('servidor com Login para Empresas (config_id): o admin usa o login clássico com as permissões; o cliente segue com config_id', async () => {
    const admin = await getAdmin();
    const prev = env.ctx.config.META_LOGIN_CONFIG_ID;
    (env.ctx.config as { META_LOGIN_CONFIG_ID: string }).META_LOGIN_CONFIG_ID = 'CFG123';
    try {
      const a = new URL((await admin.client.post('/v1/meta/connect')).data.url).searchParams;
      expect(a.get('config_id')).toBeNull();
      expect(a.get('scope')).toContain('pages_read_engagement');
      const cli = await newAccount(env);
      const c = new URL((await cli.client.post('/v1/meta/connect')).data.url).searchParams;
      expect(c.get('config_id')).toBe('CFG123');
      expect(c.get('scope')).toBeNull();
      expect((await admin.client.get('/v1/admin/meta-review')).data.loginMode).toBe('business_login');
    } finally {
      (env.ctx.config as { META_LOGIN_CONFIG_ID: string }).META_LOGIN_CONFIG_ID = prev;
    }
  });
});
