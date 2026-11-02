import { eachDay, previousWindow, reportWindow, type PeriodPreset, type ReportWindow } from '@pt/domain';
import type { Ctx } from '../context.js';
import type { OrgSummary } from '../auth/service.js';
import { FxTable } from '../fx/service.js';
import { accountDaily, metaMoneyToMinor } from '../meta/service.js';

/**
 * DEFINIÇÕES DAS MÉTRICAS (docs/METRICAS.md) — fonte da verdade: tabela `payments`.
 *  - Vendas confirmadas: pagamentos com approved_at no período e status atual = approved.
 *  - Receita: soma dessas vendas, convertida para a moeda de relatório pela cotação do DIA da aprovação.
 *  - Reembolsos/chargebacks: pagamentos com reversed_at no período (abatidos — P-08).
 *  - Pendentes: criados no período e ainda pendentes (PIX/boleto gerado). Nunca contam como venda.
 *  - Taxa de aprovação: (aprovados + revertidos) / todos os pagamentos criados no período.
 *  - Investimento: gasto da conta de anúncios (Meta, nível conta), convertido por dia.
 *  - CPA = investimento / vendas; ROAS = receita / investimento.
 *  - Compras/receita "atribuídas pela Meta" aparecem SEPARADAS (não há max() — P-21).
 */

export interface DashboardFilters {
  pixelId?: string;
  provider?: string;
}

interface Bucket { count: number; amountMinor: bigint; unconverted: number }
const empty = (): Bucket => ({ count: 0, amountMinor: 0n, unconverted: 0 });

async function salesBuckets(ctx: Ctx, org: OrgSummary, w: ReportWindow, f: DashboardFilters, fx: FxTable, column: 'approved_at' | 'reversed_at', statusFilter: string) {
  const r = await ctx.db.query(
    `SELECT to_char((${column} AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
       FROM payments
      WHERE org_id = $1 AND ${column} >= $2 AND ${column} < $3 AND ${statusFilter}
        AND ($5::uuid IS NULL OR pixel_id = $5) AND ($6::text IS NULL OR provider = $6)
      GROUP BY 1, 2`,
    [org.id, w.startUtc, w.endUtc, org.timezone, f.pixelId ?? null, f.provider ?? null],
  );
  const total = empty();
  const byDay = new Map<string, Bucket>();
  for (const row of r.rows) {
    const day = row.day as string;
    const b = byDay.get(day) ?? empty();
    b.count += row.n;
    total.count += row.n;
    if (row.currency) {
      const c = fx.convert(BigInt(row.amount), String(row.currency).trim(), org.reporting_currency, day);
      if (c.converted) { b.amountMinor += c.amountMinor; total.amountMinor += c.amountMinor; }
      else { b.unconverted += row.n; total.unconverted += row.n; }
    }
    byDay.set(day, b);
  }
  return { total, byDay };
}

/** Vendas confirmadas por hora do dia (fuso da conta) e por origem — para os gráficos do Resumo. */
async function salesBreakdown(ctx: Ctx, org: OrgSummary, w: ReportWindow, f: DashboardFilters, fx: FxTable) {
  const r = await ctx.db.query(
    `SELECT to_char((approved_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, extract(hour FROM approved_at AT TIME ZONE $4)::int AS hour,
            provider, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
       FROM payments
      WHERE org_id = $1 AND approved_at >= $2 AND approved_at < $3 AND status = 'approved'
        AND ($5::uuid IS NULL OR pixel_id = $5) AND ($6::text IS NULL OR provider = $6)
      GROUP BY 1, 2, 3, 4`,
    [org.id, w.startUtc, w.endUtc, org.timezone, f.pixelId ?? null, f.provider ?? null],
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0, revenueMinor: 0n }));
  const providers = new Map<string, { provider: string; sales: number; revenueMinor: bigint }>();
  for (const row of r.rows) {
    const h = hourly[row.hour as number]!;
    const pv = providers.get(row.provider) ?? { provider: String(row.provider), sales: 0, revenueMinor: 0n };
    h.sales += row.n;
    pv.sales += row.n;
    if (row.currency) {
      const c = fx.convert(BigInt(row.amount), String(row.currency).trim(), org.reporting_currency, row.day);
      if (c.converted) { h.revenueMinor += c.amountMinor; pv.revenueMinor += c.amountMinor; }
    }
    providers.set(pv.provider, pv);
  }
  return { hourly, byProvider: [...providers.values()].sort((a, b) => b.sales - a.sales || Number(b.revenueMinor - a.revenueMinor)) };
}

async function currenciesInUse(ctx: Ctx, orgId: string): Promise<string[]> {
  const r = await ctx.db.query('SELECT DISTINCT currency FROM payments WHERE org_id = $1 AND currency IS NOT NULL', [orgId]);
  return r.rows.map((x) => String(x.currency).trim());
}

async function windowKpis(ctx: Ctx, org: OrgSummary, w: ReportWindow, f: DashboardFilters, withMeta: boolean, breakdown = false) {
  const meta = withMeta && !f.pixelId && !f.provider ? await accountDaily(ctx, org.id, w.since, w.until).catch(() => null) : null;
  const fx = await FxTable.loadFor(ctx, [org.reporting_currency, ...(await currenciesInUse(ctx, org.id)), meta?.currency ?? ''], w.since, w.until);
  const confirmed = await salesBuckets(ctx, org, w, f, fx, 'approved_at', `status = 'approved'`);
  const reversed = await salesBuckets(ctx, org, w, f, fx, 'reversed_at', `status IN ('refunded', 'chargeback') AND approved_at IS NOT NULL`);

  const created = await ctx.db.query(
    `SELECT status, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount, max(currency) AS any_currency, count(DISTINCT currency)::int AS currencies
       FROM payments WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
        AND ($4::uuid IS NULL OR pixel_id = $4) AND ($5::text IS NULL OR provider = $5)
      GROUP BY status`,
    [org.id, w.startUtc, w.endUtc, f.pixelId ?? null, f.provider ?? null],
  );
  const byStatus = Object.fromEntries(created.rows.map((r) => [r.status, r.n as number]));
  const createdTotal = created.rows.reduce((n, r) => n + r.n, 0);
  const approvedLike = (byStatus.approved ?? 0) + (byStatus.refunded ?? 0) + (byStatus.chargeback ?? 0);
  const pendingRow = created.rows.find((r) => r.status === 'pending');

  let spendMinor = 0n;
  let metaPurchases = 0;
  let metaRevenueMinor = 0n;
  let linkClicks = 0;
  let lpv = 0;
  let spendUnconvertedDays = 0;
  const spendByDay = new Map<string, bigint>();
  if (meta) {
    for (const d of meta.days) {
      const s = fx.convert(metaMoneyToMinor(d.spend, meta.currency), meta.currency, org.reporting_currency, d.date);
      const rv = fx.convert(metaMoneyToMinor(d.revenue, meta.currency), meta.currency, org.reporting_currency, d.date);
      if (s.converted) { spendMinor += s.amountMinor; spendByDay.set(d.date, s.amountMinor); } else spendUnconvertedDays++;
      if (rv.converted) metaRevenueMinor += rv.amountMinor;
      metaPurchases += d.purchases;
      linkClicks += d.linkClicks;
      lpv += d.landingPageViews;
    }
  }

  const funnel = await ctx.db.query(
    `SELECT event_name, count(*)::int AS n FROM tracking_events
      WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)
        AND event_name IN ('PageView', 'InitiateCheckout') GROUP BY event_name`,
    [org.id, w.startUtc, w.endUtc, f.pixelId ?? null],
  );
  const ev = Object.fromEntries(funnel.rows.map((r) => [r.event_name, r.n as number]));

  const revenue = confirmed.total.amountMinor;
  const extra = breakdown ? await salesBreakdown(ctx, org, w, f, fx) : null;
  const sales = confirmed.total.count;
  return {
    window: { since: w.since, until: w.until, days: w.days },
    sales,
    revenueMinor: revenue,
    refunds: { count: reversed.total.count, amountMinor: reversed.total.amountMinor },
    pending: { count: byStatus.pending ?? 0, amountMinor: pendingRow?.currencies === 1 ? BigInt(pendingRow.amount) : null, currency: pendingRow?.currencies === 1 ? String(pendingRow.any_currency).trim() : null },
    canceledOrFailed: (byStatus.canceled ?? 0) + (byStatus.failed ?? 0),
    paymentsCreated: createdTotal,
    approvalRate: createdTotal ? approvedLike / createdTotal : null,
    unconvertedSales: confirmed.total.unconverted,
    averageTicketMinor: sales ? revenue / BigInt(sales) : null,
    meta: meta
      ? { connected: true, accountCurrency: meta.currency, spendMinor, purchases: metaPurchases, revenueMinor: metaRevenueMinor, linkClicks, landingPageViews: lpv, unconvertedDays: spendUnconvertedDays }
      : { connected: false },
    cpaMinor: meta && sales ? spendMinor / BigInt(sales) : null,
    roas: meta && spendMinor > 0n ? Number(revenue) / Number(spendMinor) : null,
    profitMinor: meta ? revenue - spendMinor : null,
    funnel: { linkClicks: meta ? linkClicks : null, landingPageViews: meta ? lpv : null, pageViews: ev.PageView ?? 0, initiateCheckouts: ev.InitiateCheckout ?? 0, sales },
    conversionRate: (ev.PageView ?? 0) > 0 ? sales / (ev.PageView ?? 1) : null,
    series: eachDay(w.since, w.until).map((day) => ({
      day,
      sales: confirmed.byDay.get(day)?.count ?? 0,
      revenueMinor: confirmed.byDay.get(day)?.amountMinor ?? 0n,
      refundsMinor: reversed.byDay.get(day)?.amountMinor ?? 0n,
      spendMinor: spendByDay.get(day) ?? (meta ? 0n : null),
    })),
    ...(extra ?? {}),
  };
}

/** Meta do mês corrente (widget da barra lateral) — só a tabela payments, sem chamar a Meta. */
export async function monthlyGoal(ctx: Ctx, org: OrgSummary) {
  const month = reportWindow('this_month', org.timezone, { now: ctx.now() });
  const fx = await FxTable.loadFor(ctx, [org.reporting_currency, ...(await currenciesInUse(ctx, org.id))], month.since, month.until);
  const b = await salesBuckets(ctx, org, month, {}, fx, 'approved_at', `status = 'approved'`);
  return { currency: org.reporting_currency, goalMinor: org.goal_monthly_minor, achievedMinor: b.total.amountMinor, sales: b.total.count };
}

export async function dashboard(ctx: Ctx, org: OrgSummary, q: { preset: PeriodPreset; since?: string; until?: string } & DashboardFilters) {
  const w = reportWindow(q.preset, org.timezone, { now: ctx.now(), since: q.since, until: q.until });
  const filters = { pixelId: q.pixelId, provider: q.provider };
  const [current, previous] = await Promise.all([
    windowKpis(ctx, org, w, filters, true, true),
    windowKpis(ctx, org, previousWindow(w), filters, true),
  ]);

  // Metas: SEMPRE hoje vs meta diária e mês corrente vs meta mensal (corrige P-23)
  const fxToday = await FxTable.loadFor(ctx, [org.reporting_currency, ...(await currenciesInUse(ctx, org.id))], reportWindow('this_month', org.timezone, { now: ctx.now() }).since, reportWindow('today', org.timezone, { now: ctx.now() }).until);
  const today = await salesBuckets(ctx, org, reportWindow('today', org.timezone, { now: ctx.now() }), {}, fxToday, 'approved_at', `status = 'approved'`);
  const month = await salesBuckets(ctx, org, reportWindow('this_month', org.timezone, { now: ctx.now() }), {}, fxToday, 'approved_at', `status = 'approved'`);

  const capi = await ctx.db.query(
    `SELECT status, count(*)::int AS n FROM capi_outbox WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
        AND ($4::uuid IS NULL OR pixel_id = $4) GROUP BY status`,
    [org.id, w.startUtc, w.endUtc, q.pixelId ?? null],
  );
  const tracked = await ctx.db.query(
    'SELECT count(*)::int AS n FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)',
    [org.id, w.startUtc, w.endUtc, q.pixelId ?? null],
  );
  const alerts = await ctx.db.query(`SELECT count(*)::int AS n FROM alerts WHERE org_id = $1 AND resolved_at IS NULL`, [org.id]);

  return {
    reportingCurrency: org.reporting_currency,
    timezone: org.timezone,
    current,
    previous,
    goals: {
      daily: { goalMinor: org.goal_daily_minor, achievedMinor: today.total.amountMinor },
      monthly: { goalMinor: org.goal_monthly_minor, achievedMinor: month.total.amountMinor },
    },
    events: {
      received: tracked.rows[0]?.n ?? 0,
      capi: Object.fromEntries(capi.rows.map((r) => [r.status, r.n])),
    },
    openAlerts: alerts.rows[0]?.n ?? 0,
  };
}
