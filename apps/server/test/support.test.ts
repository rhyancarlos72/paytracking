import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, newAccount, newPlatformAdmin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('suporte pelo WhatsApp', () => {
  it('sem número configurado o botão não aparece; só o dono da plataforma define o número', async () => {
    const pub = new Client(env);
    expect((await pub.get('/v1/public/support')).data).toMatchObject({ whatsapp: null });
    const comum = await newAccount(env);
    expect((await comum.client.put('/v1/admin/support', { whatsapp: '11999990000' })).status).toBe(403);
    const admin = await newPlatformAdmin(env);
    expect((await admin.client.put('/v1/admin/support', { whatsapp: '123' })).status).toBe(400);
    const ok = await admin.client.put('/v1/admin/support', { whatsapp: '(11) 99999-0000', message: 'Oi! Vim pelo painel.' });
    expect(ok.data).toEqual({ whatsapp: '5511999990000', message: 'Oi! Vim pelo painel.' }); // com DDI para o wa.me
    expect((await pub.get('/v1/public/support')).data).toEqual({ whatsapp: '5511999990000', message: 'Oi! Vim pelo painel.' });
    // apagar o número esconde o botão
    await admin.client.put('/v1/admin/support', { whatsapp: '' });
    expect((await pub.get('/v1/public/support')).data.whatsapp).toBeNull();
  });
});
