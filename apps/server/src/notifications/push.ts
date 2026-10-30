import webpush from 'web-push';
import type { Ctx } from '../context.js';
import { getVapidKeys } from './vapid.js';

export interface PushPayload { title: string; body: string; url?: string; tag?: string; kind?: 'sale' | 'test' | 'alert' }
export interface PushResult { sent: number; failed: number; removed: number; configured: boolean }

/**
 * Envia Web Push para as inscrições informadas. A criptografia/assinatura é do web-push
 * (generateRequestDetails); o envio passa pelo fetch do contexto (testável, com timeout).
 * Inscrição expirada (404/410) é removida. Falhas nunca afetam quem chamou.
 */
async function deliver(ctx: Ctx, subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>, payload: PushPayload): Promise<PushResult> {
  const vapid = await getVapidKeys(ctx);
  const body = JSON.stringify({ type: payload.kind ?? 'sale', title: payload.title, body: payload.body, url: payload.url ?? '/', tag: payload.tag, ts: Date.now() });
  let sent = 0, failed = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const req = webpush.generateRequestDetails(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        // urgência alta: o Android entrega na hora mesmo com a tela apagada (economia de bateria)
        { TTL: 6 * 3600, urgency: 'high', topic: undefined, vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
      );
      const res = await ctx.fetch(req.endpoint, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.body as unknown as Uint8Array,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) {
        await ctx.db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        removed++;
      } else if (res.ok) {
        sent++;
        await ctx.db.query('UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1', [s.id]).catch(() => undefined);
      } else {
        failed++;
        ctx.log.warn({ status: res.status, host: new URL(s.endpoint).host }, 'push recusado pelo serviço de notificações');
      }
    } catch (e) {
      failed++;
      ctx.log.warn({ err: String(e) }, 'push falhou');
    }
  }));
  return { sent, failed, removed, configured: true };
}

/** Venda aprovada: todos os dispositivos inscritos da organização. */
export async function sendPushToOrg(ctx: Ctx, orgId: string, payload: PushPayload): Promise<PushResult> {
  const subs = await ctx.db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE org_id = $1', [orgId]);
  return deliver(ctx, subs.rows, payload);
}

/** Teste: só os dispositivos de quem pediu (não incomoda o resto da equipe). */
export async function sendPushToUser(ctx: Ctx, userId: string, orgId: string, payload: PushPayload): Promise<PushResult> {
  const subs = await ctx.db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  return deliver(ctx, subs.rows, payload);
}
