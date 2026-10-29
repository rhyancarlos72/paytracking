import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { auth, parse, requireRole } from '../lib/http.js';
import { sendPushToOrg } from './push.js';

export function pushRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/push/config', async (req) => {
    const a = auth(req);
    const n = await ctx.db.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND org_id = $2', [a.user.id, a.org.id]);
    return { vapidPublicKey: ctx.config.VAPID_PUBLIC_KEY || null, configured: !!(ctx.config.VAPID_PUBLIC_KEY && ctx.config.VAPID_PRIVATE_KEY), subscriptions: n.rows[0]?.n ?? 0 };
  });

  app.post('/v1/push/subscriptions', async (req) => {
    const a = requireRole(req, 'viewer');
    const b = parse(z.object({
      endpoint: z.string().url().max(800),
      keys: z.object({ p256dh: z.string().min(10).max(255), auth: z.string().min(8).max(255) }),
    }), req.body);
    await ctx.db.query(
      `INSERT INTO push_subscriptions(user_id, org_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, org_id = EXCLUDED.org_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
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

  app.post('/v1/push/test', async (req) => {
    const a = requireRole(req, 'viewer');
    return sendPushToOrg(ctx, a.org.id, { title: 'Teste de notificação', body: 'As notificações de venda estão funcionando.', url: '/' });
  });
}
