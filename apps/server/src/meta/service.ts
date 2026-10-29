import { localDate, parseAmount } from '@pt/domain';
import type { Ctx } from '../context.js';
import { raiseAlert } from '../capi/outbox.js';
import { MetaApiError, MetaClient, metricsFromInsight, type MetricRow } from './client.js';

export interface Connection {
  client: MetaClient;
  accountId: string | null;
  accountCurrency: string | null;
  status: string;
  expiresAt: Date | null;
  scopes: string[];
}

export async function getConnection(ctx: Ctx, orgId: string): Promise<Connection | null> {
  const r = await ctx.db.query(
    'SELECT access_token_enc, selected_ad_account_id, ad_account_currency, status, token_expires_at, scopes FROM meta_connections WHERE org_id = $1',
    [orgId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    client: new MetaClient(ctx, ctx.box.decrypt(row.access_token_enc)),
    accountId: row.selected_ad_account_id,
    accountCurrency: row.ad_account_currency?.trim() ?? null,
    status: row.status,
    expiresAt: row.token_expires_at,
    scopes: row.scopes,
  };
}

/** Token expirado/revogado → marca a conexão e gera alerta acionável (cenário 12). */
export async function handleMetaError(ctx: Ctx, orgId: string, e: unknown): Promise<never> {
  if (e instanceof MetaApiError && e.isTokenError) {
    await ctx.db.query(`UPDATE meta_connections SET status = 'expired', last_error = $2, updated_at = now() WHERE org_id = $1`, [orgId, e.message]);
    await raiseAlert(ctx.db, orgId, {
      kind: 'meta_token', severity: 'critical', dedupKey: 'meta_token',
      title: 'Conexão com o Facebook Ads expirou ou foi revogada', detail: 'Reconecte a conta em Integrações → Meta Ads.',
    });
  } else if (e instanceof MetaApiError) {
    await ctx.db.query('UPDATE meta_connections SET last_error = $2, updated_at = now() WHERE org_id = $1', [orgId, e.message]);
  }
  throw e;
}

async function cached<T>(ctx: Ctx, orgId: string, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const r = await ctx.db.query(
    'SELECT data FROM meta_insights_cache WHERE org_id = $1 AND cache_key = $2 AND fetched_at > now() - make_interval(secs => $3)',
    [orgId, key, ttlSec],
  );
  if (r.rows[0]) return r.rows[0].data as T;
  const data = await load();
  await ctx.db.query(
    `INSERT INTO meta_insights_cache(org_id, cache_key, data) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
    [orgId, key, JSON.stringify(data)],
  );
  return data;
}

const ttlFor = (until: string) => (until >= localDate(new Date(), 'UTC') ? 300 : 6 * 3600);

export interface DailySpend extends MetricRow {
  date: string;
}

/** Gasto/métricas diárias da conta selecionada (moeda da conta). null = sem conexão. */
export async function accountDaily(ctx: Ctx, orgId: string, since: string, until: string): Promise<{ currency: string; days: DailySpend[] } | null> {
  const conn = await getConnection(ctx, orgId);
  if (!conn || !conn.accountId || conn.status !== 'active') return null;
  try {
    const rows = await cached(ctx, orgId, `daily:${conn.accountId}:${since}:${until}`, ttlFor(until), () =>
      conn.client.accountInsightsDaily(conn.accountId!, since, until));
    const days = rows.map((r: any) => ({ ...metricsFromInsight(r), date: String(r.date_start) }));
    return { currency: days[0]?.currency ?? conn.accountCurrency ?? 'BRL', days };
  } catch (e) {
    return handleMetaError(ctx, orgId, e);
  }
}

export interface EntityRow extends MetricRow {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective?: string;
  campaignId?: string;
  campaignName?: string;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
}

export async function entities(
  ctx: Ctx, orgId: string, level: 'campaign' | 'adset', since: string, until: string, campaignIds: string[] = [],
): Promise<{ currency: string; rows: EntityRow[] } | null> {
  const conn = await getConnection(ctx, orgId);
  if (!conn || !conn.accountId || conn.status !== 'active') return null;
  try {
    const key = `${level}:${conn.accountId}:${since}:${until}:${campaignIds.join(',')}`;
    const raw = await cached(ctx, orgId, key, Math.min(ttlFor(until), 120), () =>
      level === 'campaign' ? conn.client.campaigns(conn.accountId!, since, until) : conn.client.adsets(conn.accountId!, since, until, campaignIds));
    const currency = conn.accountCurrency ?? 'BRL';
    const rows: EntityRow[] = raw.map((c: any) => ({
      ...metricsFromInsight(c.insights?.data?.[0]),
      currency,
      id: String(c.id), name: String(c.name ?? ''), status: String(c.status ?? ''), effectiveStatus: String(c.effective_status ?? c.status ?? ''),
      objective: c.objective, campaignId: c.campaign_id, campaignName: c.campaign?.name,
      dailyBudgetMinor: c.daily_budget != null ? String(c.daily_budget) : null,
      lifetimeBudgetMinor: c.lifetime_budget != null ? String(c.lifetime_budget) : null,
    }));
    return { currency, rows };
  } catch (e) {
    return handleMetaError(ctx, orgId, e);
  }
}

/** "12.34" (moeda da conta) → unidade mínima. */
export const metaMoneyToMinor = (v: string, currency: string): bigint => parseAmount(v, currency, 'major') ?? 0n;

export async function invalidateCache(ctx: Ctx, orgId: string) {
  await ctx.db.query('DELETE FROM meta_insights_cache WHERE org_id = $1', [orgId]);
}
