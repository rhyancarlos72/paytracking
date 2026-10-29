import { createPool } from '@pt/db';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { dispatchBatch } from './capi/dispatcher.js';
import { refreshRates } from './fx/service.js';
import { raiseAlert } from './capi/outbox.js';

/**
 * Worker: entrega da CAPI (loop curto), câmbio (a cada 6h), retenção e manutenção (a cada hora).
 * Pode rodar em processo separado (`pnpm worker`) ou embutido no servidor (EMBEDDED_WORKER=true).
 */

export async function maintenance(ctx: Ctx): Promise<Record<string, number>> {
  const q = (sql: string, p: unknown[] = []) => ctx.db.query(sql, p).then((r) => r.rowCount ?? 0);
  const out = {
    trackingEvents: await q(`DELETE FROM tracking_events WHERE received_at < now() - make_interval(days => $1)`, [ctx.config.TRACKING_RETENTION_DAYS]),
    webhookBodies: await q(`UPDATE webhook_receipts SET body_enc = NULL WHERE body_enc IS NOT NULL AND received_at < now() - make_interval(days => $1)`, [ctx.config.WEBHOOK_BODY_RETENTION_DAYS]),
    identities: await q(`DELETE FROM visitor_identities WHERE updated_at < now() - interval '120 days'`),
    sessions: await q(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`),
    tokens: await q(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`),
    rateLimits: await q(`DELETE FROM rate_limits WHERE window_end < now()`),
    oauthStates: await q(`DELETE FROM oauth_states WHERE expires_at < now()`),
    cache: await q(`DELETE FROM meta_insights_cache WHERE fetched_at < now() - interval '2 days'`),
    expiredCharges: await q(`UPDATE billing_charges SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`),
  };
  // aviso antecipado de expiração do token da Meta (~60 dias)
  const exp = await ctx.db.query(
    `SELECT org_id FROM meta_connections WHERE status = 'active' AND token_expires_at IS NOT NULL AND token_expires_at < now() + interval '7 days'`,
  );
  for (const r of exp.rows) {
    await raiseAlert(ctx.db, r.org_id, {
      kind: 'meta_token_expiring', severity: 'warning', dedupKey: 'meta_token_expiring',
      title: 'A conexão com o Facebook Ads expira em menos de 7 dias', detail: 'Reconecte a conta em Integrações → Meta Ads para renovar.',
    });
  }
  return out;
}

export function startWorker(ctx: Ctx, opts: { intervalMs?: number } = {}) {
  let stopped = false;
  const interval = opts.intervalMs ?? 1000;
  let lastFx = 0;
  let lastMaint = 0;

  const loop = async () => {
    while (!stopped) {
      try {
        const s = ctx.config.CAPI_DISPATCH === 'paused' ? { claimed: 0, sent: 0, retried: 0, dead: 0 } : await dispatchBatch(ctx, 50);
        if (s.claimed) ctx.log.info({ ...s }, 'capi dispatch');
        const now = Date.now();
        if (now - lastFx > 6 * 3600_000) {
          lastFx = now;
          refreshRates(ctx).then((r) => ctx.log.info(r, 'câmbio atualizado')).catch((e) => ctx.log.warn({ err: String(e) }, 'câmbio falhou'));
        }
        if (now - lastMaint > 3600_000) {
          lastMaint = now;
          maintenance(ctx).then((r) => ctx.log.info(r, 'manutenção')).catch((e) => ctx.log.warn({ err: String(e) }, 'manutenção falhou'));
        }
        if (s.claimed < 50) await new Promise((r) => setTimeout(r, interval));
      } catch (e) {
        // banco indisponível: espera e tenta de novo, sem derrubar o processo (cenário 19)
        ctx.log.error({ err: String(e) }, 'worker: erro no ciclo');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  const done = loop();
  return { stop: async () => { stopped = true; await done; } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, 5);
  const ctx = createCtx(config, pool);
  const w = startWorker(ctx);
  const shutdown = async () => { await w.stop(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  ctx.log.info({}, 'worker iniciado');
}
