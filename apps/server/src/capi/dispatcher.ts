import { backoffDelayMs, classifyCapiResponse, type DeliveryOutcome } from '@pt/domain';
import type { Ctx } from '../context.js';
import { raiseAlert, resolveAlert } from './outbox.js';

/**
 * Worker de entrega à Meta Conversions API (ADR-004).
 * - Reserva com FOR UPDATE SKIP LOCKED (várias instâncias sem envio duplicado).
 * - "sent" só com events_received ≥ 1 na resposta (P-15).
 * - Erro temporário/rate limit: backoff exponencial com jitter. Permanente: "dead" + alerta (P-14).
 * - Token vai no corpo da requisição, nunca na URL (não vaza em logs).
 */

interface OutboxRow {
  id: string;
  org_id: string;
  pixel_id: string;
  event_name: string;
  event_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface PixelCfg {
  meta_pixel_id: string;
  capi_token_enc: string | null;
  test_event_code: string | null;
  active: boolean;
  name: string;
}

export interface DispatchStats {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
}

export async function dispatchBatch(ctx: Ctx, limit = 50): Promise<DispatchStats> {
  const claimed = await ctx.db.query<OutboxRow>(
    `UPDATE capi_outbox SET status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM capi_outbox
         WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'sending' AND locked_until < now())
         ORDER BY next_attempt_at, id
         LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, org_id, pixel_id, event_name, event_id, payload, attempts`,
    [limit],
  );
  const stats: DispatchStats = { claimed: claimed.rowCount ?? 0, sent: 0, retried: 0, dead: 0 };
  if (!claimed.rowCount) return stats;

  const pixelIds = [...new Set(claimed.rows.map((r) => r.pixel_id))];
  const pr = await ctx.db.query(
    'SELECT id, meta_pixel_id, capi_token_enc, test_event_code, active, name FROM pixels WHERE id = ANY($1)',
    [pixelIds],
  );
  const pixels = new Map<string, PixelCfg>(pr.rows.map((p) => [p.id, p]));

  // concorrência limitada para não estourar rate limit da Meta
  const queue = [...claimed.rows];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const outcome = await deliver(ctx, row, pixels.get(row.pixel_id));
      if (outcome === 'sent') stats.sent++;
      else if (outcome === 'retry') stats.retried++;
      else stats.dead++;
    }
  });
  await Promise.all(workers);
  return stats;
}

async function deliver(ctx: Ctx, row: OutboxRow, pixel: PixelCfg | undefined): Promise<'sent' | 'retry' | 'dead'> {
  if (!pixel || !pixel.active || !pixel.capi_token_enc) {
    const reason = !pixel ? 'Pixel removido.' : !pixel.active ? 'Pixel inativo: ative o pixel e reprocesse.' : 'Pixel sem token da CAPI: edite o pixel e reprocesse.';
    await markDead(ctx, row, reason, 'config', null, undefined);
    if (pixel) {
      await raiseAlert(ctx.db, row.org_id, {
        kind: 'capi_config', severity: 'critical', dedupKey: `capi_config:${row.pixel_id}`,
        title: `Eventos não enviados — pixel "${pixel.name}"`, detail: reason,
      });
    }
    return 'dead';
  }

  const body: Record<string, unknown> = {
    data: [row.payload],
    access_token: ctx.box.decrypt(pixel.capi_token_enc),
  };
  const testCode = pixel.test_event_code || ctx.config.META_TEST_EVENT_CODE;
  if (testCode) body.test_event_code = testCode;

  const started = Date.now();
  let http = 0;
  let outcome: DeliveryOutcome;
  try {
    const res = await ctx.fetch(`${ctx.config.META_GRAPH_BASE_URL}/${ctx.config.META_GRAPH_VERSION}/${pixel.meta_pixel_id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    http = res.status;
    const json = await res.json().catch(() => null);
    outcome = classifyCapiResponse(http, json);
  } catch (e) {
    outcome = { kind: 'retryable', message: `Falha de rede: ${(e as Error).message}`.slice(0, 300) };
  }
  const duration = Date.now() - started;

  await ctx.db.query(
    `INSERT INTO capi_attempts(outbox_id, http_status, duration_ms, outcome, error_code, message, fbtrace_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.id, http || null, duration, outcome.kind, 'code' in outcome ? outcome.code ?? null : null,
      outcome.kind === 'sent' ? null : outcome.message, outcome.fbtraceId ?? null],
  );

  if (outcome.kind === 'sent') {
    await ctx.db.query(
      `UPDATE capi_outbox SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL, last_error_class = NULL,
              last_http_status = $2, events_received = $3, fbtrace_id = $4 WHERE id = $1`,
      [row.id, http, outcome.eventsReceived, outcome.fbtraceId ?? null],
    );
    await resolveAlert(ctx.db, row.org_id, `capi_failing:${row.pixel_id}`);
    await resolveAlert(ctx.db, row.org_id, `capi_config:${row.pixel_id}`);
    return 'sent';
  }

  const max = ctx.config.CAPI_MAX_ATTEMPTS;
  if (outcome.kind === 'permanent' || row.attempts >= max) {
    await markDead(ctx, row, outcome.message, outcome.kind, http, outcome.fbtraceId);
    const tokenProblem = outcome.kind === 'permanent' && (outcome.code === 190 || outcome.code === 200 || outcome.code === 10);
    await raiseAlert(ctx.db, row.org_id, {
      kind: tokenProblem ? 'capi_token' : 'capi_failing',
      severity: 'critical',
      dedupKey: tokenProblem ? `capi_config:${row.pixel_id}` : `capi_failing:${row.pixel_id}`,
      title: tokenProblem ? `Token da CAPI inválido ou sem permissão — pixel "${pixel.name}"` : `Falha persistente no envio à Meta — pixel "${pixel.name}"`,
      detail: `${row.event_name} ${row.event_id}: ${outcome.message}`,
    });
    return 'dead';
  }

  let delay = backoffDelayMs(row.attempts);
  if (outcome.kind === 'rate_limited') delay = Math.max(delay, 5 * 60_000);
  await ctx.db.query(
    `UPDATE capi_outbox SET status = 'pending', locked_until = NULL, next_attempt_at = now() + make_interval(secs => $2),
            last_error = $3, last_error_class = $4, last_http_status = $5, fbtrace_id = $6 WHERE id = $1`,
    [row.id, delay / 1000, outcome.message, outcome.kind, http || null, outcome.fbtraceId ?? null],
  );
  return 'retry';
}

async function markDead(ctx: Ctx, row: OutboxRow, message: string, cls: string, http: number | null, fbtraceId: string | undefined) {
  await ctx.db.query(
    `UPDATE capi_outbox SET status = 'dead', locked_until = NULL, last_error = $2, last_error_class = $3, last_http_status = $4,
            fbtrace_id = COALESCE($5, fbtrace_id) WHERE id = $1`,
    [row.id, message.slice(0, 1000), cls, http, fbtraceId ?? null],
  );
}

/** Reprocessamento seguro: mesmo registro, mesmo event_id (a Meta deduplica). */
export async function requeue(ctx: Ctx, orgId: string, filter: { id?: number; all?: boolean }): Promise<number> {
  const r = await ctx.db.query(
    `UPDATE capi_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, last_error_class = NULL
      WHERE org_id = $1 AND status = 'dead' AND ($2::bigint IS NULL OR id = $2)`,
    [orgId, filter.all ? null : filter.id ?? -1],
  );
  return r.rowCount ?? 0;
}
