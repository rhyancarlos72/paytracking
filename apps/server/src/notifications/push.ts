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
/**
 * Envia para todos os aparelhos da organização. Quem ativou o modo privado ("olho") recebe a versão
 * sem nomes de campanha/pixel (privatePayload), já que a notificação aparece na tela bloqueada.
 */
export async function sendPushToOrg(ctx: Ctx, orgId: string, payload: PushPayload, privatePayload?: PushPayload): Promise<PushResult> {
  const subs = await ctx.db.query<{ id: string; endpoint: string; p256dh: string; auth: string; hide_names: boolean }>(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, COALESCE(u.hide_names, false) AS hide_names
       FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id WHERE ps.org_id = $1`, [orgId]);
  if (!privatePayload) return deliver(ctx, subs.rows, payload);
  const [open, hidden] = [subs.rows.filter((s) => !s.hide_names), subs.rows.filter((s) => s.hide_names)];
  const [a, b] = await Promise.all([deliver(ctx, open, payload), deliver(ctx, hidden, privatePayload)]);
  return { sent: a.sent + b.sent, removed: a.removed + b.removed, failed: a.failed + b.failed, configured: a.configured && b.configured };
}

/** Teste: só os dispositivos de quem pediu (não incomoda o resto da equipe). */
export async function sendPushToUser(ctx: Ctx, userId: string, orgId: string, payload: PushPayload): Promise<PushResult> {
  const subs = await ctx.db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  return deliver(ctx, subs.rows, payload);
}
