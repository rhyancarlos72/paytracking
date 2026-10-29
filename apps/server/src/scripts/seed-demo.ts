import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createPool, tx } from '@pt/db';
import { publicKey } from '../lib/crypto.js';

/**
 * Dados de DEMONSTRAÇÃO para desenvolvimento local. Tudo leva o rótulo "[DEMONSTRAÇÃO]",
 * o provider "demo" e nenhum token da CAPI — nada é enviado à Meta. Recusa rodar em produção.
 *   DATABASE_URL=... pnpm --filter @pt/server seed:demo
 */
if (process.env.NODE_ENV === 'production') {
  console.error('seed:demo não roda com NODE_ENV=production.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}

const EMAIL = 'demo@demo.paytracking.dev';
const PASSWORD = 'demo-' + randomBytes(4).toString('hex');
const pool = createPool(url, 2);

// gerador determinístico: os números de demonstração são sempre os mesmos
let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

try {
  await tx(pool, async (c) => {
    const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [EMAIL]);
    if (exists.rowCount) throw new Error(`${EMAIL} já existe — apague o banco de desenvolvimento para recriar.`);
    const u = await c.query<{ id: string }>(
      `INSERT INTO users(email, password_hash, name, email_verified_at) VALUES ($1, $2, '[DEMONSTRAÇÃO] Usuário', now()) RETURNING id`,
      [EMAIL, bcrypt.hashSync(PASSWORD, 10)],
    );
    const o = await c.query<{ id: string }>(
      `INSERT INTO organizations(name, plan_status, plan_expires_at, plan_started_at, goal_daily_minor, goal_monthly_minor)
       VALUES ('[DEMONSTRAÇÃO] Loja Exemplo', 'exempt', NULL, now(), 50000, 1500000) RETURNING id`,
    );
    const orgId = o.rows[0]!.id;
    await c.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, u.rows[0]!.id]);
    const p = await c.query<{ id: string }>(
      `INSERT INTO pixels(org_id, name, meta_pixel_id, capi_token_enc, public_key) VALUES ($1, '[DEMONSTRAÇÃO] Pixel', '1000000000001', NULL, $2) RETURNING id`,
      [orgId, publicKey()],
    );
    const pixelId = p.rows[0]!.id;

    const campaigns = ['Demo — Prospecção', 'Demo — Remarketing', 'Demo — Lookalike'];
    let n = 0;
    for (let d = 29; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86_400_000);
      const views = 80 + Math.floor(rnd() * 120);
      for (let i = 0; i < views; i++) {
        const at = new Date(day.getTime() - Math.floor(rnd() * 86_400_000));
        const ev = rnd() < 0.12 ? 'InitiateCheckout' : 'PageView';
        await c.query(
          `INSERT INTO tracking_events(org_id, pixel_id, event_name, event_id, source, utm_source, utm_campaign, match_keys, received_at)
           VALUES ($1, $2, $3, $4, 'browser', 'facebook', $5, '{fbp,client_ip_address,client_user_agent}', $6)`,
          [orgId, pixelId, ev, `demo_${randomBytes(8).toString('hex')}`, campaigns[Math.floor(rnd() * 3)], at],
        );
      }
      const salesToday = Math.floor(rnd() * 6);
      for (let i = 0; i < salesToday; i++) {
        const at = new Date(day.getTime() - Math.floor(rnd() * 86_400_000));
        const r = rnd();
        const status = r < 0.8 ? 'approved' : r < 0.9 ? 'pending' : 'refunded';
        await c.query(
          `INSERT INTO payments(org_id, pixel_id, provider, transaction_id, status, amount_minor, currency, utm_source, utm_campaign,
                                created_at, updated_at, pending_at, approved_at, reversed_at)
           VALUES ($1, $2, 'demo', $3, $4, $5, 'BRL', 'facebook', $6, $7, $7, $7,
                   CASE WHEN $4 IN ('approved','refunded') THEN $7::timestamptz END, CASE WHEN $4 = 'refunded' THEN $7::timestamptz END)`,
          [orgId, pixelId, `DEMO-${++n}`, status, [9700, 19700, 49700][Math.floor(rnd() * 3)], campaigns[Math.floor(rnd() * 3)], at],
        );
      }
    }
  });
  console.log(`Demonstração criada. Login: ${EMAIL} / senha: ${PASSWORD}`);
  console.log('Todos os registros estão rotulados como [DEMONSTRAÇÃO] / provider "demo" e não são enviados à Meta.');
} finally {
  await pool.end();
}
