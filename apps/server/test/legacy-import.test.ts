import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importLegacy, splitProductIds, type LegacySource } from '../src/legacy/import.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { Client, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

// Dados fictícios no formato das tabelas MySQL do PHP (schema.sql + ensure_column)
const PROJECT_TOKEN = 'tok-projeto-legado-abc123';
const USER_GATEWAY_TOKEN = 'gw-usuario-legado-xyz789';
const phpHash = bcrypt.hashSync('SenhaAntiga1', 10).replace(/^\$2a\$/, '$2y$'); // formato de password_hash() do PHP

const source = (): LegacySource => ({
  users: async () => [
    {
      id: 7, email: 'Cliente@Legado.dev', password_hash: phpHash, created_at: '2025-03-01 10:00:00',
      plan_status: 'active', plan_expires_at: '2026-12-01 00:00:00', goal_daily: '500.00', goal_monthly: '15000.00', hide_email: 1,
      gateway_token_hash: sha256Hex(USER_GATEWAY_TOKEN), gateway_token_raw: USER_GATEWAY_TOKEN,
      gateway_secrets: '{"kiwify":"segredo-kiwify"}',
    },
    { id: 8, email: 'sem-hash@legado.dev', password_hash: 'md5-antigo', created_at: '2025-03-01 10:00:00' },
  ],
  projects: async () => [
    {
      id: 11, user_id: 7, name: 'Loja Principal', pixel_id: '1234567890123', public_key: 'pk_legado_0001', capi_token: 'EAAG-capi-legado',
      integration_token_hash: sha256Hex(PROJECT_TOKEN), test_event_code: '', active: 1, product_ids: '9452226, 777 ;888',
      currency: 'BRL', country: 'BR', ic_rule_type: 'contains', ic_rule_value: '/checkout', created_at: '2025-03-02 10:00:00',
    },
    {
      id: 12, user_id: 7, name: 'Loja 2', pixel_id: '9999999999', capi_token: '', active: 1, product_ids: '777',
      created_at: '2025-03-03 10:00:00',
    },
    { id: 13, user_id: 99, name: 'Órfão', pixel_id: '1111111111', capi_token: 'x', active: 1, created_at: '2025-03-03 10:00:00' },
  ],
  sales: async () => [
    { id: 1, project_id: 11, transaction_id: 'OLD-1', value: '197.00', currency: 'BRL', created_at: '2025-10-01 12:00:00' },
    { id: 2, project_id: 11, transaction_id: 'OLD-2', value: '10.00', currency: 'USD', created_at: '2025-10-02 12:00:00' },
  ],
  metaConnections: async () => [{ user_id: 7, access_token: 'EAAB-meta-legado', token_expires_at: '2026-12-01 00:00:00', selected_account: 'act_123' }],
  pushSubscriptions: async () => [{ user_id: 7, endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' }],
});

describe('importação do legado (MySQL → Postgres)', () => {
  it('simulação não grava nada', async () => {
    const r = await importLegacy(env.db, env.ctx.box, source(), { dryRun: true });
    expect(r.users).toBe(1);
    expect((await env.db.query(`SELECT count(*)::int n FROM users WHERE legacy_user_id IS NOT NULL`)).rows[0].n).toBe(0);
  });

  it('importa contas, pixels, integrações e histórico; segredos cifrados', async () => {
    const r = await importLegacy(env.db, env.ctx.box, source());
    expect(r).toMatchObject({ users: 1, orgs: 1, pixels: 2, sales: 2, metaConnections: 1, pushSubscriptions: 1 });
    expect(r.warnings.some((w) => w.includes('#8'))).toBe(true); // hash inválido → ignorado, com aviso
    expect(r.warnings.some((w) => w.includes('#13'))).toBe(true); // projeto sem dono importado
    expect(r.warnings.some((w) => w.includes('"777"'))).toBe(true); // produto em dois pixels

    const px = await env.db.query(`SELECT capi_token_enc, public_key, ic_rule_type FROM pixels WHERE legacy_project_id = 11`);
    expect(px.rows[0].public_key).toBe('pk_legado_0001'); // snippets instalados continuam funcionando
    expect(px.rows[0].capi_token_enc).not.toContain('EAAG');
    expect(env.ctx.box.decrypt(px.rows[0].capi_token_enc)).toBe('EAAG-capi-legado');
    const meta = await env.db.query(`SELECT access_token_enc FROM meta_connections`);
    expect(meta.rows[0].access_token_enc).not.toContain('EAAB');

    const sales = await env.db.query(`SELECT transaction_id, amount_minor, currency, provider FROM payments ORDER BY transaction_id`);
    expect(sales.rows.map((s) => [s.transaction_id, s.amount_minor, s.currency, s.provider])).toEqual([
      ['OLD-1', 19700n, 'BRL', 'legacy'], ['OLD-2', 1000n, 'USD', 'legacy'],
    ]);
    // histórico não vira evento para a Meta
    expect((await env.db.query(`SELECT count(*)::int n FROM capi_outbox`)).rows[0].n).toBe(0);
    const org = await env.db.query(`SELECT plan_status, goal_daily_minor FROM organizations WHERE legacy_user_id = 7`);
    expect(org.rows[0]).toMatchObject({ plan_status: 'active', goal_daily_minor: 50000n });
  });

  it('é idempotente: rodar de novo não duplica', async () => {
    const r = await importLegacy(env.db, env.ctx.box, source());
    expect([r.sales, r.integrations, r.products]).toEqual([0, 0, 0]);
    expect((await env.db.query(`SELECT count(*)::int n FROM pixels`)).rows[0].n).toBe(2);
    expect((await env.db.query(`SELECT count(*)::int n FROM users`)).rows[0].n).toBe(1);
  });

  it('login com a senha antiga (bcrypt $2y$ do PHP) funciona', async () => {
    const c = new Client(env);
    const r = await c.post('/v1/auth/login', { email: 'cliente@legado.dev', password: 'SenhaAntiga1' });
    expect(r.status).toBe(200);
    expect((await c.get('/v1/pixels')).data.pixels).toHaveLength(2);
  });

  it('URLs de webhook já configuradas nos gateways continuam valendo', async () => {
    const ck = await env.app.inject({
      method: 'POST', url: '/api/webhook.php', headers: { authorization: `Bearer ${PROJECT_TOKEN}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'payment.approved', transaction_id: 'NEW-1', value: '49,90', product_id: '9452226' }),
    });
    expect(ck.json()).toMatchObject({ processed: true, status: 'approved' });

    const gw = await env.app.inject({
      method: 'POST', url: `/api/webhook_gateway.php?gateway=lowify&token=${USER_GATEWAY_TOKEN}`, headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'sale.paid', data: { id: 'LOW-1', amount: 97, customer: { email: 'g@h.com' } } }),
    });
    expect(gw.json()).toMatchObject({ processed: true, status: 'approved' });
    // a Kiwify tinha segredo no legado: continua exigindo assinatura
    const kw = await env.app.inject({
      method: 'POST', url: `/api/webhook_gateway.php?gateway=kiwify&token=${USER_GATEWAY_TOKEN}`, headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ order_id: 'K-1', order_status: 'paid' }),
    });
    expect(kw.statusCode).toBe(401);
  });

  it('divide product_ids como o PHP', () => {
    expect(splitProductIds(' 1, 2;3  1 ')).toEqual(['1', '2', '3']);
    expect(splitProductIds(null)).toEqual([]);
  });
});
