import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deviceName } from '../src/notifications/routes.js';
import { newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

// http_ece é a criptografia de payload do Web Push (dependência do web-push)
const ece = createRequire(createRequire(import.meta.url).resolve('web-push'))('http_ece') as {
  decrypt(buf: Buffer, p: { version: string; privateKey: ReturnType<typeof createECDH>; authSecret: string }): Buffer;
};

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
beforeEach(() => env.fake.reset());

/** "Celular" de teste: chaves ECDH próprias, como o navegador gera ao se inscrever. */
function fakeDevice(name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16).toString('base64url');
  return {
    ecdh, auth,
    sub: { endpoint: `https://push.example.com/${name}-${randomBytes(4).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } },
    decrypt(body: Buffer) { return JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8')); },
  };
}

const captured: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = [];
function pushService(status = 201) {
  env.fake.on(/push\.example\.com/, async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    captured.push({ url: url.href, headers, body: Buffer.from(init?.body as Uint8Array) });
    return new Response(null, { status });
  });
}
const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20)); };

describe('Web Push (notificações no celular)', () => {
  it('chaves VAPID geradas uma vez, guardadas cifradas e estáveis', async () => {
    const acc = await newAccount(env);
    const a = (await acc.client.get('/v1/push/config')).data;
    const b = (await acc.client.get('/v1/push/config')).data;
    expect(a).toMatchObject({ configured: true });
    expect(a.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(b.vapidPublicKey).toBe(a.vapidPublicKey);
    const row = (await env.db.query(`SELECT value FROM app_settings WHERE key = 'vapid_private_enc'`)).rows[0];
    expect(row.value.startsWith('v1.')).toBe(true); // privada cifrada (SecretBox), nunca em texto
  });

  it('venda aprovada chega cifrada no celular, com valor e link da venda', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client);
    const dev = fakeDevice('android');
    expect((await acc.client.post('/v1/push/subscriptions', dev.sub)).status).toBe(200);
    const ck = await newIntegration(acc.client, 'checkout');
    pushService();
    captured.length = 0;
    const r = await env.app.inject({ method: 'POST', url: '/v1/webhooks/checkout', payload: JSON.stringify({ event: 'paid', transaction_id: 'PUSH-1', value: '197,00' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${ck.token}` } });
    expect(r.json()).toMatchObject({ status: 'approved' });
    await waitFor(() => captured.length > 0);
    const req = captured.find((c) => c.url === dev.sub.endpoint)!;
    expect(req.headers['content-encoding']).toBe('aes128gcm');
    expect(req.headers.urgency).toBe('high');
    expect(req.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(req.body.toString('utf8')).not.toContain('197'); // payload cifrado
    const msg = dev.decrypt(req.body);
    expect(msg).toMatchObject({ type: 'sale', title: 'Venda aprovada! 🔥', url: `/vendas/${r.json().paymentId}` });
    expect(msg.body.replace(/\s/g, ' ')).toContain('R$ 197,00');
  });

  it('inscrição expirada (410) é removida', async () => {
    const acc = await newAccount(env);
    const dev = fakeDevice('velho');
    await acc.client.post('/v1/push/subscriptions', dev.sub);
    pushService(410);
    const r = (await acc.client.post('/v1/push/test')).data;
    expect(r).toMatchObject({ sent: 0, removed: 1 });
    expect((await env.db.query('SELECT count(*)::int n FROM push_subscriptions WHERE endpoint = $1', [dev.sub.endpoint])).rows[0].n).toBe(0);
  });

  it('teste vai só para os dispositivos de quem pediu; lista e remove dispositivos', async () => {
    const acc = await newAccount(env);
    const mine = fakeDevice('meu');
    await acc.client.req('POST', '/v1/push/subscriptions', mine.sub, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' });
    const other = await newAccount(env);
    const theirs = fakeDevice('outro');
    await other.client.post('/v1/push/subscriptions', theirs.sub);
    pushService();
    captured.length = 0;
    expect((await acc.client.post('/v1/push/test')).data).toMatchObject({ sent: 1 });
    expect(captured.map((c) => c.url)).toEqual([mine.sub.endpoint]);
    expect(mine.decrypt(captured[0]!.body).type).toBe('test');

    const devices = (await acc.client.get('/v1/push/devices')).data.devices;
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: 'Android · Chrome' });
    expect(devices[0].lastSuccessAt).toBeTruthy();
    // não remove dispositivo de outra pessoa
    expect((await other.client.del(`/v1/push/devices/${devices[0].id}`)).data).toEqual({ ok: false });
    expect((await acc.client.del(`/v1/push/devices/${devices[0].id}`)).data).toEqual({ ok: true });
  });

  it('endpoint de push sem https é recusado', async () => {
    const acc = await newAccount(env);
    const dev = fakeDevice('x');
    expect((await acc.client.post('/v1/push/subscriptions', { ...dev.sub, endpoint: 'http://push.example.com/x' })).status).toBe(400);
  });

  it('nome do dispositivo', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130')).toBe('Windows · Edge');
  });
});
