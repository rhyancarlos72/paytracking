import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { auth, parse, requireRole } from '../lib/http.js';
import { sendPushToUser } from './push.js';
import { getVapidKeys } from './vapid.js';

/** "Android · Chrome", "iPhone · Safari (app)"… a partir do User-Agent (só para exibição). */
export function deviceName(ua: string): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const browser = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${os} · ${browser}`;
}

export function pushRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/push/config', async (req) => {
    const a = auth(req);
    const keys = await getVapidKeys(ctx);
    const n = await ctx.db.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND org_id = $2', [a.user.id, a.org.id]);
    return { vapidPublicKey: keys.publicKey, configured: true, subscriptions: n.rows[0]?.n ?? 0 };
  });

  app.get('/v1/push/devices', async (req) => {
    const a = auth(req);
    const r = await ctx.db.query(
      `SELECT id, endpoint, user_agent, created_at, last_success_at FROM push_subscriptions
        WHERE user_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [a.user.id, a.org.id],
    );
    return {
      devices: r.rows.map((d) => ({
        id: d.id, name: deviceName(String(d.user_agent ?? '')), createdAt: d.created_at, lastSuccessAt: d.last_success_at,
        // o painel compara com a inscrição deste navegador para mostrar "este dispositivo"
        endpointHash: Buffer.from(String(d.endpoint)).toString('base64url').slice(-24),
      })),
    };
  });

  app.post('/v1/push/subscriptions', async (req) => {
    const a = requireRole(req, 'viewer');
    const b = parse(z.object({
      endpoint: z.string().url().max(800).refine((u) => u.startsWith('https://'), 'endpoint de push precisa ser https'),
      keys: z.object({ p256dh: z.string().min(10).max(255), auth: z.string().min(8).max(255) }),
    }), req.body);
    await ctx.db.query(
      `INSERT INTO push_subscriptions(user_id, org_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, org_id = EXCLUDED.org_id, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [a.user.id, a.org.id, b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers['user-agent'] ?? '').slice(0, 255)],
    );
    return { ok: true };
  });

  app.post('/v1/push/unsubscribe', async (req) => {
    const a = auth(req);
    const { endpoint } = parse(z.object({ endpoint: z.string().url().max(800) }), req.body);
    await ctx.db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, a.user.id]);
    return { ok: true };
  });

  app.delete('/v1/push/devices/:id', async (req) => {
    const a = auth(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query('DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2', [id, a.user.id]);
    return { ok: (r.rowCount ?? 0) > 0 };
  });

  app.post('/v1/push/test', async (req) => {
    const a = requireRole(req, 'viewer');
    return sendPushToUser(ctx, a.user.id, a.org.id, {
      kind: 'test', title: 'Venda aprovada! 🔥 (teste)', body: 'R$ 197,00 · as notificações deste dispositivo estão funcionando.', url: '/', tag: `test-${Date.now()}`,
    });
  });
}
