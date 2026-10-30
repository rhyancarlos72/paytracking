import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispatchBatch } from '../src/capi/dispatcher.js';
import { metaOk, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

/**
 * Requisições reais do paytrack_dispatch.php (checkout próprio do cliente), capturadas byte a byte:
 * PIX gerado e pagamento aprovado com order bump, assinadas com HMAC-SHA256.
 */
const fx = JSON.parse(readFileSync(new URL('./fixtures/paytrack-dispatch-php.json', import.meta.url), 'utf8')) as {
  secret: string; requests: Array<{ event: string; signature: string; body: string }>;
};
const [pending, approved] = fx.requests as [typeof fx.requests[0], typeof fx.requests[0]];

let env: TestEnv;
let token = '';
beforeAll(async () => {
  env = await setup();
  const acc = await newAccount(env);
  await newPixel(acc.client, { productIds: ['9452302'] });
  token = (await newIntegration(acc.client, 'checkout', { secret: fx.secret })).token;
});
afterAll(async () => { await env.close(); });

const send = (body: string, signature: string | null) => env.app.inject({
  method: 'POST', url: '/api/webhook.php', payload: body,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(signature ? { 'x-paytrack-signature': signature } : {}) },
});

describe('checkout próprio — paytrack_dispatch.php', () => {
  it('PIX gerado vira pagamento pendente, sem Purchase', async () => {
    const r = await send(pending.body, pending.signature);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ processed: true, status: 'pending', queued: false });
  });

  it('pagamento aprovado gera Purchase completo, com bump e o purchase_event_id do checkout', async () => {
    const r = await send(approved.body, approved.signature);
    expect(r.json()).toMatchObject({ processed: true, status: 'approved', previousStatus: 'pending', queued: true });
    const p = await env.db.query(`SELECT amount_minor, currency, utm_campaign, products FROM payments WHERE transaction_id = 'TX-9001'`);
    expect(p.rows[0]).toMatchObject({ amount_minor: 19700n, currency: 'BRL', utm_campaign: 'Campanha Black' });
    expect(p.rows[0].products).toHaveLength(2);

    metaOk(env.fake);
    await dispatchBatch(env.ctx);
    const sent = JSON.parse(env.fake.calls.find((c) => c.url.includes('/events'))!.body!).data[0];
    expect(sent.event_name).toBe('Purchase');
    expect(sent.event_id).toBe('purchase_9452302_1793300000_ab12'); // deduplica com o Pixel do navegador
    expect(sent.custom_data).toMatchObject({ value: 197, currency: 'BRL', content_ids: ['9452302', '7777'], num_items: 2, utm_campaign: 'Campanha Black' });
    for (const k of ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id', 'fbp', 'fbc', 'client_ip_address', 'client_user_agent']) {
      expect(sent.user_data[k], k).toBeTruthy();
    }
    expect(JSON.stringify(sent.user_data)).not.toContain('Maria.Souza@Exemplo.com'); // PII só em hash
  });

  it('reenvio do mesmo aprovado é idempotente', async () => {
    expect((await send(approved.body, approved.signature)).json()).toMatchObject({ duplicate: true });
  });

  it('assinatura errada ou ausente é recusada (POST forjado)', async () => {
    const forged = approved.body.replace('"value":197', '"value":999');
    expect((await send(forged, approved.signature)).statusCode).toBe(401);
    expect((await send(approved.body, null)).statusCode).toBe(401);
  });
});
