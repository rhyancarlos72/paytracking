import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MATCH_KEYS, reportWindow, UTM_KEYS, type PeriodPreset } from '@pt/domain';
import type { Ctx } from '../context.js';
import { requeue } from '../capi/dispatcher.js';
import { FxTable } from '../fx/service.js';
import { notFound } from '../lib/errors.js';
import { jsonSafe, parse, requireRole } from '../lib/http.js';
import { periodQuery } from '../meta/routes.js';
import { audit } from '../orgs/routes.js';
import { dashboard } from './dashboard.js';

const uuidOpt = z.string().uuid().optional();

export function reportRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/reports/dashboard', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({ pixelId: uuidOpt, provider: z.string().max(20).optional() }), req.query);
    return jsonSafe(await dashboard(ctx, a.org, { ...q, preset: q.preset as PeriodPreset }));
  });

  // ------------------------------------------------------------------ vendas / pagamentos
  /**
   * Vendas aprovadas recebidas depois de um cursor — alimenta o aviso/som de venda no painel.
   * Usa a hora em que o WEBHOOK CHEGOU (relógio do banco), não a hora de pagamento informada
   * pelo gateway: um webhook atrasado ainda toca. Devolve 15 s de sobreposição (transação que
   * estava confirmando quando o cursor foi lido); o painel guarda os ids já avisados.
   * Sem `after`, só devolve o cursor: ao abrir o painel não toca pelo que já existia.
   */
  app.get('/v1/sales/feed', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(z.object({
      after: z.string().datetime({ offset: true }).optional(),
      /** piso fixo: cursor de quando o painel abriu — a janela de segurança nunca volta antes dele */
      floor: z.string().datetime({ offset: true }).optional(),
    }), req.query);
    const now = (await ctx.db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    if (!q.after) return { cursor: now.toISOString(), sales: [] };
    const r = await ctx.db.query(
      `SELECT p.id, p.provider, p.transaction_id, p.amount_minor, p.currency, p.utm_campaign, p.approved_at, px.name AS pixel_name,
              r.received_at
         FROM payment_transitions t
         JOIN payments p ON p.id = t.payment_id
         JOIN webhook_receipts r ON r.id = t.receipt_id
         LEFT JOIN pixels px ON px.id = p.pixel_id
        WHERE p.org_id = $1 AND t.to_status = 'approved' AND p.status = 'approved'
          AND r.received_at > GREATEST($2::timestamptz - interval '15 seconds', COALESCE($4::timestamptz, '-infinity'))
          AND r.received_at <= $3
        ORDER BY r.received_at, t.id LIMIT 50`,
      [a.org.id, q.after, now, q.floor ?? null],
    );
    return jsonSafe({ cursor: now.toISOString(), sales: r.rows });
  });

  app.get('/v1/payments', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({
      status: z.enum(['pending', 'approved', 'refunded', 'chargeback', 'canceled', 'failed']).optional(),
      provider: z.string().max(20).optional(), pixelId: uuidOpt, search: z.string().max(128).optional(),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }), req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const params = [a.org.id, w.startUtc, w.endUtc, q.status ?? null, q.provider ?? null, q.pixelId ?? null, q.search ? `%${q.search}%` : null];
    const where = `p.org_id = $1 AND p.created_at >= $2 AND p.created_at < $3 AND ($4::text IS NULL OR p.status = $4)
                   AND ($5::text IS NULL OR p.provider = $5) AND ($6::uuid IS NULL OR p.pixel_id = $6)
                   AND ($7::text IS NULL OR p.transaction_id ILIKE $7)`;
    const total = await ctx.db.query(`SELECT count(*)::int AS n FROM payments p WHERE ${where}`, params);
    const rows = await ctx.db.query(
      `SELECT p.id, p.provider, p.transaction_id, p.status, p.amount_minor, p.currency, p.utm_source, p.utm_campaign, p.utm_content,
              p.created_at, p.approved_at, p.reversed_at, px.name AS pixel_name,
              (SELECT status FROM capi_outbox o WHERE o.payment_id = p.id AND o.event_name = 'Purchase' LIMIT 1) AS purchase_capi_status
         FROM payments p LEFT JOIN pixels px ON px.id = p.pixel_id
        WHERE ${where} ORDER BY p.created_at DESC LIMIT 50 OFFSET $8`,
      [...params, (q.page - 1) * 50],
    );
    return jsonSafe({ total: total.rows[0]?.n ?? 0, page: q.page, pageSize: 50, payments: rows.rows });
  });

  app.get('/v1/payments/:id', async (req) => {
    const a = requireRole(req, 'viewer');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const p = await ctx.db.query(
      `SELECT p.*, px.name AS pixel_name FROM payments p LEFT JOIN pixels px ON px.id = p.pixel_id WHERE p.id = $1 AND p.org_id = $2`,
      [id, a.org.id],
    );
    if (!p.rows[0]) throw notFound('Pagamento não encontrado.');
    const [transitions, receipts, outbox] = await Promise.all([
      ctx.db.query('SELECT from_status, to_status, occurred_at, receipt_id FROM payment_transitions WHERE payment_id = $1 ORDER BY id', [id]),
      ctx.db.query(`SELECT id, received_at, outcome, reason, gateway_event, correlation_id, signature_method FROM webhook_receipts WHERE payment_id = $1 AND org_id = $2 ORDER BY id`, [id, a.org.id]),
      ctx.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.last_error, o.events_received, o.fbtrace_id, o.sent_at, o.payload,
                (SELECT json_agg(json_build_object('at', attempted_at, 'http', http_status, 'outcome', outcome, 'message', message) ORDER BY id)
                   FROM capi_attempts t WHERE t.outbox_id = o.id) AS attempts_log
           FROM capi_outbox o WHERE o.payment_id = $1 AND o.org_id = $2`,
        [id, a.org.id],
      ),
    ]);
    return jsonSafe({ payment: p.rows[0], transitions: transitions.rows, receipts: receipts.rows, capi: outbox.rows });
  });

  // ------------------------------------------------------------------ eventos (outbox CAPI)
  app.get('/v1/events', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({
      status: z.enum(['pending', 'sending', 'sent', 'dead']).optional(),
      eventName: z.string().max(40).optional(), pixelId: uuidOpt,
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }), req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const params = [a.org.id, w.startUtc, w.endUtc, q.status ?? null, q.eventName ?? null, q.pixelId ?? null];
    const base = `o.org_id = $1 AND o.created_at >= $2 AND o.created_at < $3
                   AND ($5::text IS NULL OR o.event_name = $5) AND ($6::uuid IS NULL OR o.pixel_id = $6)`;
    const where = `${base} AND ($4::text IS NULL OR o.status = $4)`;
    const [rows, counts] = await Promise.all([
      ctx.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.next_attempt_at, o.last_error, o.last_error_class,
                o.last_http_status, o.events_received, o.fbtrace_id, o.created_at, o.sent_at, o.payment_id, o.correlation_id,
                o.payload, px.name AS pixel_name
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id WHERE ${where} ORDER BY o.id DESC LIMIT 50 OFFSET $7`,
        [...params, (q.page - 1) * 50],
      ),
      ctx.db.query(`SELECT o.status, count(*)::int AS n FROM capi_outbox o WHERE ${base} AND ($4::text IS NULL OR $4::text IS NOT NULL) GROUP BY o.status`, params),
    ]);
    return jsonSafe({ page: q.page, pageSize: 50, events: rows.rows, counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])) });
  });

  app.post('/v1/events/requeue', async (req) => {
    const a = requireRole(req, 'analyst');
    const b = parse(z.object({ id: z.coerce.number().int().positive().optional(), all: z.boolean().optional() }), req.body);
    const n = await requeue(ctx, a.org.id, b);
    await audit(ctx, a.org.id, a.user.id, 'capi.requeued', b.id ? String(b.id) : 'all', { count: n });
    return { requeued: n };
  });

  // ------------------------------------------------------------------ diagnóstico CAPI
  app.get('/v1/reports/capi', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery, req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const [byPixel, failures, latency, receipts] = await Promise.all([
      ctx.db.query(
        `SELECT px.id AS pixel_id, px.name AS pixel_name, px.meta_pixel_id, o.event_name,
                count(*)::int AS total, count(*) FILTER (WHERE o.status = 'sent')::int AS sent,
                count(*) FILTER (WHERE o.status IN ('pending', 'sending'))::int AS pending,
                count(*) FILTER (WHERE o.status = 'dead')::int AS dead
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id
          WHERE o.org_id = $1 AND o.created_at >= $2 AND o.created_at < $3
          GROUP BY 1, 2, 3, 4 ORDER BY 2, 4`,
        [a.org.id, w.startUtc, w.endUtc],
      ),
      ctx.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.last_error, o.last_error_class, o.last_http_status, o.fbtrace_id,
                o.created_at, px.name AS pixel_name
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id
          WHERE o.org_id = $1 AND o.last_error IS NOT NULL AND o.created_at >= $2 AND o.created_at < $3
          ORDER BY o.id DESC LIMIT 50`,
        [a.org.id, w.startUtc, w.endUtc],
      ),
      ctx.db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (sent_at - created_at))) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (sent_at - created_at))) AS p95
           FROM capi_outbox WHERE org_id = $1 AND status = 'sent' AND created_at >= $2 AND created_at < $3`,
        [a.org.id, w.startUtc, w.endUtc],
      ),
      ctx.db.query(
        `SELECT provider, outcome, count(*)::int AS n FROM webhook_receipts
          WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1, 2 ORDER BY 1, 2`,
        [a.org.id, w.startUtc, w.endUtc],
      ),
    ]);
    return {
      byPixel: byPixel.rows, failures: failures.rows,
      latencySeconds: { p50: latency.rows[0]?.p50 ?? null, p95: latency.rows[0]?.p95 ?? null },
      webhooks: receipts.rows,
      dispatchPaused: ctx.config.CAPI_DISPATCH === 'paused',
    };
  });

  /** Cobertura de correspondência + prontidão para dedup (porta de cobertura.php, agregada no SQL). */
  app.get('/v1/reports/coverage', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({ pixelId: uuidOpt, group: z.enum(['day', 'week', 'month']).default('day') }), req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const presence = MATCH_KEYS.map((k, i) => `count(*) FILTER (WHERE '${k}' = ANY(match_keys))::int AS k${i}`).join(', ');
    const base = `FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)`;
    const params = [a.org.id, w.startUtc, w.endUtc, q.pixelId ?? null, a.org.timezone];
    const [totals, periods, byEvent] = await Promise.all([
      ctx.db.query(`SELECT count(*)::int AS total, ${presence} ${base}`, params.slice(0, 4)),
      ctx.db.query(
        `SELECT to_char(date_trunc('${q.group}', received_at AT TIME ZONE $5), 'YYYY-MM-DD') AS period, count(*)::int AS total,
                avg(cardinality(match_keys))::float AS avg_params,
                count(*) FILTER (WHERE match_keys && ARRAY['fbp','fbc','external_id'])::int AS dedup_ready,
                count(*) FILTER (WHERE source = 'browser')::int AS browser, count(*) FILTER (WHERE source = 'server')::int AS server
           ${base} GROUP BY 1 ORDER BY 1 DESC`,
        params,
      ),
      ctx.db.query(
        `SELECT event_name, count(*)::int AS total, avg(cardinality(match_keys))::float AS avg_params,
                count(*) FILTER (WHERE match_keys && ARRAY['fbp','fbc','external_id'])::int AS dedup_ready
           ${base} GROUP BY 1 ORDER BY 2 DESC`,
        params.slice(0, 4),
      ),
    ]);
    const t = totals.rows[0] ?? { total: 0 };
    return {
      matchKeys: MATCH_KEYS,
      total: t.total,
      presence: Object.fromEntries(MATCH_KEYS.map((k, i) => [k, t.total ? (t[`k${i}`] as number) / t.total : 0])),
      periods: periods.rows,
      byEvent: byEvent.rows,
    };
  });

  /** Atribuição por UTM: funil do navegador + vendas confirmadas (moedas convertidas — corrige P-28). */
  app.get('/v1/reports/attribution', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({ dimension: z.enum(['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term']).default('utm_campaign') }), req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const dim = q.dimension;
    if (!UTM_KEYS.includes(dim)) throw notFound();
    const events = await ctx.db.query(
      `SELECT COALESCE(utm_source, '(direto)') AS source, COALESCE(${dim}, '—') AS key,
              count(*) FILTER (WHERE event_name = 'PageView')::int AS page_views,
              count(*) FILTER (WHERE event_name = 'InitiateCheckout')::int AS initiate_checkouts
         FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1, 2`,
      [a.org.id, w.startUtc, w.endUtc],
    );
    const sales = await ctx.db.query(
      `SELECT COALESCE(utm_source, '(direto)') AS source, COALESCE(${dim}, '—') AS key, currency,
              to_char((approved_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
         FROM payments WHERE org_id = $1 AND status = 'approved' AND approved_at >= $2 AND approved_at < $3 GROUP BY 1, 2, 3, 4`,
      [a.org.id, w.startUtc, w.endUtc, a.org.timezone],
    );
    const fx = await FxTable.load(ctx.db, [a.org.reporting_currency, ...sales.rows.map((r) => String(r.currency ?? '').trim())], w.since, w.until);
    const rows = new Map<string, { source: string; key: string; pageViews: number; initiateCheckouts: number; sales: number; revenueMinor: bigint; unconverted: number }>();
    const get = (s: string, k: string) => {
      const id = `${s}\u0000${k}`;
      if (!rows.has(id)) rows.set(id, { source: s, key: k, pageViews: 0, initiateCheckouts: 0, sales: 0, revenueMinor: 0n, unconverted: 0 });
      return rows.get(id)!;
    };
    for (const e of events.rows) Object.assign(get(e.source, e.key), { pageViews: e.page_views, initiateCheckouts: e.initiate_checkouts });
    for (const s of sales.rows) {
      const r = get(s.source, s.key);
      r.sales += s.n;
      if (s.currency) {
        const c = fx.convert(BigInt(s.amount), String(s.currency).trim(), a.org.reporting_currency, s.day);
        if (c.converted) r.revenueMinor += c.amountMinor; else r.unconverted += s.n;
      }
    }
    const list = [...rows.values()].sort((x, y) => (y.revenueMinor > x.revenueMinor ? 1 : y.revenueMinor < x.revenueMinor ? -1 : y.pageViews - x.pageViews));
    return jsonSafe({ dimension: dim, reportingCurrency: a.org.reporting_currency, rows: list.slice(0, 500) });
  });

  // ------------------------------------------------------------------ alertas e conciliação
  app.get('/v1/alerts', async (req) => {
    const a = requireRole(req, 'viewer');
    const r = await ctx.db.query(
      `SELECT id, kind, severity, title, detail, occurrences, first_seen_at, last_seen_at, resolved_at FROM alerts
        WHERE org_id = $1 ORDER BY resolved_at IS NOT NULL, last_seen_at DESC LIMIT 100`,
      [a.org.id],
    );
    return { alerts: r.rows };
  });

  app.post('/v1/alerts/:id/resolve', async (req) => {
    const a = requireRole(req, 'analyst');
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    await ctx.db.query('UPDATE alerts SET resolved_at = now() WHERE id = $1 AND org_id = $2', [id, a.org.id]);
    return { ok: true };
  });

  /** Vendas aprovadas × Purchase entregue à Meta (regra 5 do prompt). */
  app.get('/v1/reports/reconciliation', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery, req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const r = await ctx.db.query(
      `SELECT
         count(*)::int AS approved,
         count(*) FILTER (WHERE o.status = 'sent')::int AS purchase_sent,
         count(*) FILTER (WHERE o.status IN ('pending', 'sending'))::int AS purchase_pending,
         count(*) FILTER (WHERE o.status = 'dead')::int AS purchase_dead,
         count(*) FILTER (WHERE o.id IS NULL AND p.pixel_id IS NULL)::int AS without_pixel,
         count(*) FILTER (WHERE o.id IS NULL AND p.pixel_id IS NOT NULL)::int AS not_queued
       FROM payments p LEFT JOIN capi_outbox o ON o.payment_id = p.id AND o.event_name = 'Purchase'
      WHERE p.org_id = $1 AND p.approved_at >= $2 AND p.approved_at < $3`,
      [a.org.id, w.startUtc, w.endUtc],
    );
    return r.rows[0];
  });
}
