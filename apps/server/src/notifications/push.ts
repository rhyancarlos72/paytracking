import webpush from 'web-push';
import type { Ctx } from '../context.js';

/** Web Push de venda aprovada (porta do PushNotifier). Falhas nunca afetam o webhook. */
export async function sendPushToOrg(ctx: Ctx, orgId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = ctx.config;
  if (!pub || !priv) return { sent: 0, failed: 0, removed: 0, configured: false };
  const subs = await ctx.db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE org_id = $1', [orgId]);
  let sent = 0, failed = 0, removed = 0;
  const body = JSON.stringify({ ...payload, url: payload.url ?? '/', icon: '/icon-192.png', type: 'sale' });
  await Promise.all(subs.rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 3600, vapidDetails: { subject, publicKey: pub, privateKey: priv } },
      );
      sent++;
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await ctx.db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        removed++;
      }
    }
  }));
  return { sent, failed, removed, configured: true };
}
