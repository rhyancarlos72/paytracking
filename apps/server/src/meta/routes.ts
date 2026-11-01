import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { matchUtmToRow, parseAmount, PERIOD_PRESETS, reportWindow, currencyExponent, type PeriodPreset } from '@pt/domain';
import type { Ctx } from '../context.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, badRequest } from '../lib/errors.js';
import { jsonSafe, parse, requireRole } from '../lib/http.js';
import { audit } from '../orgs/routes.js';
import { FxTable } from '../fx/service.js';
import { resolveAlert } from '../capi/outbox.js';
import { exchangeCode, MetaApiError, MetaClient, metaAuthUrl, metaRedirectUri, normalizeAccountId } from './client.js';
import { entities, getConnection, handleMetaError, invalidateCache, metaMoneyToMinor } from './service.js';

export const periodQuery = z.object({
  preset: z.enum(PERIOD_PRESETS as unknown as [PeriodPreset, ...PeriodPreset[]]).default('today'),
  since: z.string().optional(),
  until: z.string().optional(),
});

function metaError(e: unknown): never {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) throw new AppError(409, 'meta_token_expired', 'A conexão com o Facebook Ads expirou ou foi revogada. Reconecte a conta.');
    if (e.isRateLimit) throw new AppError(429, 'meta_rate_limited', 'Limite de chamadas da Meta atingido. Tente novamente em alguns minutos.');
    if (e.isPermission) throw new AppError(403, 'meta_permission', `A Meta recusou a operação por permissão: ${e.message}. Reconecte concedendo "ads_management".`);
    throw new AppError(502, 'meta_error', `Erro da Meta: ${e.message}`);
  }
  throw e;
}

export function metaRoutes(app: FastifyInstance, ctx: Ctx) {
  const configured = () => !!ctx.config.META_APP_ID && !!ctx.config.META_APP_SECRET;

  app.get('/v1/meta/status', async (req) => {
    const a = requireRole(req, 'viewer');
    const r = await ctx.db.query(
      'SELECT selected_ad_account_id, ad_account_currency, status, token_expires_at, scopes, last_error, updated_at FROM meta_connections WHERE org_id = $1',
      [a.org.id],
    );
    return {
      appConfigured: configured(),
      loginMode: ctx.config.META_LOGIN_CONFIG_ID ? 'business_login' : 'classic',
      redirectUri: metaRedirectUri(ctx),
      graphVersion: ctx.config.META_GRAPH_VERSION,
      connection: r.rows[0] ?? null,
    };
  });

  app.post('/v1/meta/connect', async (req) => {
    const a = requireRole(req, 'admin');
    if (!configured()) throw badRequest('META_APP_ID e META_APP_SECRET não estão configurados no servidor.');
    const state = randomToken(24);
    await ctx.db.query(`INSERT INTO oauth_states(state, org_id, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`, [state, a.org.id, a.user.id]);
    return { url: metaAuthUrl(ctx, state) };
  });

  /** Callback OAuth: o state é de uso único, expira em 10 min e é amarrado à organização (cenário 11). */
  app.get('/v1/meta/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const back = (params: Record<string, string>) => reply.redirect(`${ctx.config.APP_URL}/integracoes/meta?${new URLSearchParams(params)}`);
    const st = await ctx.db.query('DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING org_id, user_id', [q.state ?? '']);
    const row = st.rows[0];
    if (!row) return back({ error: 'Falha de validação do OAuth (state inválido ou expirado). Tente novamente.' });
    if (req.auth && req.auth.user.id !== row.user_id) return back({ error: 'Sessão diferente da que iniciou a conexão.' });
    if (q.error || !q.code) return back({ error: `Conexão cancelada: ${q.error_description ?? q.error ?? 'sem código'}` });
    try {
      const tok = await exchangeCode(ctx, q.code);
      const client = new MetaClient(ctx, tok.token);
      const scopes = await client.permissions().catch(() => [] as string[]);
      await ctx.db.query(
        `INSERT INTO meta_connections(org_id, connected_by, access_token_enc, token_expires_at, scopes, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (org_id) DO UPDATE SET connected_by = EXCLUDED.connected_by, access_token_enc = EXCLUDED.access_token_enc,
           token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes, status = 'active', last_error = NULL, updated_at = now()`,
        [row.org_id, row.user_id, ctx.box.encrypt(tok.token), tok.expiresAt, scopes],
      );
      await invalidateCache(ctx, row.org_id);
      await resolveAlert(ctx.db, row.org_id, 'meta_token');
      await audit(ctx, row.org_id, row.user_id, 'meta.connected', undefined, { scopes });
      return back({ connected: '1' });
    } catch (e) {
      return back({ error: `Não foi possível conectar: ${(e as Error).message}` });
    }
  });

  app.post('/v1/meta/disconnect', async (req) => {
    const a = requireRole(req, 'admin');
    await ctx.db.query('DELETE FROM meta_connections WHERE org_id = $1', [a.org.id]);
    await invalidateCache(ctx, a.org.id);
    await audit(ctx, a.org.id, a.user.id, 'meta.disconnected');
    return { ok: true };
  });

  app.get('/v1/meta/ad-accounts', async (req) => {
    const a = requireRole(req, 'viewer');
    const conn = await getConnection(ctx, a.org.id);
    if (!conn) return { accounts: [], selected: null };
    try {
      const accounts = await conn.client.adAccounts();
      return {
        selected: conn.accountId,
        accounts: accounts.map((x: any) => ({ id: normalizeAccountId(String(x.account_id)), name: x.name, currency: x.currency, status: x.account_status, timezone: x.timezone_name })),
      };
    } catch (e) {
      return handleMetaError(ctx, a.org.id, e).catch(metaError);
    }
  });

  app.post('/v1/meta/ad-account', async (req) => {
    const a = requireRole(req, 'admin');
    const { accountId, currency } = parse(z.object({ accountId: z.string().min(3).max(40), currency: z.string().regex(/^[A-Z]{3}$/) }), req.body);
    const r = await ctx.db.query(
      'UPDATE meta_connections SET selected_ad_account_id = $2, ad_account_currency = $3, updated_at = now() WHERE org_id = $1',
      [a.org.id, normalizeAccountId(accountId), currency],
    );
    if (!r.rowCount) throw badRequest('Conecte o Facebook Ads antes.');
    await invalidateCache(ctx, a.org.id);
    await audit(ctx, a.org.id, a.user.id, 'meta.ad_account_selected', accountId);
    return { ok: true };
  });

  /**
   * Campanhas/conjuntos com métricas da Meta + vendas RASTREADAS (payments) casadas por UTM.
   * As duas fontes são devolvidas lado a lado (não há mais max() escondido — P-21).
   * Valores da Meta são convertidos da moeda da conta para a moeda de relatório pela
   * cotação do último dia do período (fxDate).
   */
  app.get('/v1/meta/campaigns', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(periodQuery.extend({
      level: z.enum(['campaign', 'adset']).default('campaign'),
      campaignIds: z.string().optional(),
    }), req.query);
    const w = reportWindow(q.preset as PeriodPreset, a.org.timezone, { since: q.since, until: q.until });
    const campaignIds = (q.campaignIds ?? '').split(',').map((s) => s.replace(/\D+/g, '')).filter(Boolean);
    let data;
    try {
      data = await entities(ctx, a.org.id, q.level, w.since, w.until, campaignIds);
    } catch (e) {
      metaError(e);
    }
    if (!data) return { connected: false, rows: [] };
    const rep = a.org.reporting_currency;

    // mapa conjunto → campanha para roll-up (vendas que trazem só o conjunto em utm_content)
    let adsetMap: Map<string, string> = new Map();
    if (q.level === 'campaign') {
      const adsets = await entities(ctx, a.org.id, 'adset', w.since, w.until).catch(() => null);
      adsetMap = new Map((adsets?.rows ?? []).flatMap((s) => [[`id:${s.id}`, s.campaignId ?? ''], [`name:${s.name.toLowerCase()}`, s.campaignId ?? '']]));
    }

    const pays = await ctx.db.query(
      `SELECT amount_minor, currency, approved_at, utm_campaign, utm_content, utm_term, utm_medium, utm_id
         FROM payments WHERE org_id = $1 AND status = 'approved' AND approved_at >= $2 AND approved_at < $3`,
      [a.org.id, w.startUtc, w.endUtc],
    );
    const fx = await FxTable.loadFor(ctx, [rep, data.currency, ...pays.rows.map((p) => String(p.currency ?? '').trim())], w.since, w.until);
    const acc = data.rows.map(() => ({ sales: 0, revenue: 0n, unconverted: 0 }));
    const rows = data.rows.map((r) => ({ id: r.id, name: r.name }));
    for (const p of pays.rows) {
      const values: string[] = [p.utm_campaign, p.utm_content, p.utm_term, p.utm_medium, p.utm_id].filter(Boolean);
      if (q.level === 'campaign') {
        // conjunto → campanha, aceitando "nome|id" (parâmetros de URL recomendados)
        const parts = values.flatMap((v) => [v, ...String(v).split('|').map((x) => x.trim())]).filter(Boolean);
        for (const v of parts) {
          const parent = adsetMap.get(`id:${v}`) ?? adsetMap.get(`name:${String(v).toLowerCase()}`);
          if (parent) { values.push(parent); break; }
        }
      }
      const i = matchUtmToRow(values, rows);
      if (i < 0) continue;
      acc[i]!.sales++;
      if (p.amount_minor != null && p.currency) {
        const conv = fx.convert(BigInt(p.amount_minor), String(p.currency).trim(), rep, p.approved_at.toISOString().slice(0, 10));
        if (conv.converted) acc[i]!.revenue += conv.amountMinor; else acc[i]!.unconverted++;
      }
    }

    const fxDate = w.until;
    const conv = (v: string) => fx.convert(metaMoneyToMinor(v, data!.currency), data!.currency, rep, fxDate);
    const metaConvertible = fx.quote(data.currency, rep, fxDate) !== null;
    return jsonSafe({
      connected: true,
      window: { since: w.since, until: w.until },
      accountCurrency: data.currency,
      reportingCurrency: rep,
      fx: { date: fxDate, converted: metaConvertible, rate: fx.quote(data.currency, rep, fxDate)?.rate ?? null },
      rows: data.rows.map((r, i) => ({
        id: r.id, name: r.name, status: r.status, effectiveStatus: r.effectiveStatus, objective: r.objective,
        campaignId: r.campaignId, campaignName: r.campaignName,
        budget: r.dailyBudgetMinor != null
          ? { type: 'daily', amountMinor: r.dailyBudgetMinor, currency: data!.currency }
          : r.lifetimeBudgetMinor != null ? { type: 'lifetime', amountMinor: r.lifetimeBudgetMinor, currency: data!.currency } : null,
        spendMinor: conv(r.spend).amountMinor,
        cpcMinor: conv(r.cpc).amountMinor,
        impressions: r.impressions, clicks: r.clicks, linkClicks: r.linkClicks, landingPageViews: r.landingPageViews, ctr: r.ctr,
        meta: { purchases: r.purchases, revenueMinor: conv(r.revenue).amountMinor },
        tracked: { sales: acc[i]!.sales, revenueMinor: acc[i]!.revenue, unconverted: acc[i]!.unconverted },
      })),
    });
  });

  const entityParams = z.object({ id: z.string().regex(/^\d{5,30}$/) });

  async function client(orgId: string) {
    const conn = await getConnection(ctx, orgId);
    if (!conn) throw badRequest('Conecte o Facebook Ads antes.');
    return conn;
  }

  app.post('/v1/meta/entities/:id/status', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(entityParams, req.params);
    const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }), req.body);
    const conn = await client(a.org.id);
    try { await conn.client.updateStatus(id, status); } catch (e) { metaError(e); }
    await invalidateCache(ctx, a.org.id);
    await audit(ctx, a.org.id, a.user.id, 'meta.status_changed', id, { status });
    return { ok: true, status };
  });

  app.post('/v1/meta/entities/:id/duplicate', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(entityParams, req.params);
    const { type } = parse(z.object({ type: z.enum(['campaign', 'adset']) }), req.body);
    const conn = await client(a.org.id);
    let res: any;
    try { res = await conn.client.duplicate(id, type); } catch (e) { metaError(e); }
    await invalidateCache(ctx, a.org.id);
    await audit(ctx, a.org.id, a.user.id, 'meta.duplicated', id, { type });
    return { ok: true, newId: String(res?.copied_campaign_id ?? res?.copied_adset_id ?? res?.id ?? '') };
  });

  /** Orçamento informado NA MOEDA DA CONTA (exibida na tela) — sem câmbio implícito. */
  app.post('/v1/meta/entities/:id/budget', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(entityParams, req.params);
    const b = parse(z.object({ type: z.enum(['daily', 'lifetime']), amount: z.string().min(1).max(20) }), req.body);
    const conn = await client(a.org.id);
    const cur = conn.accountCurrency;
    if (!cur) throw badRequest('Selecione a conta de anúncios novamente para identificar a moeda.');
    const minor = parseAmount(b.amount, cur, 'major');
    if (minor === null || minor <= 0n) throw badRequest('Valor de orçamento inválido.');
    try { await conn.client.updateBudget(id, b.type === 'daily' ? 'daily_budget' : 'lifetime_budget', minor); } catch (e) { metaError(e); }
    await invalidateCache(ctx, a.org.id);
    await audit(ctx, a.org.id, a.user.id, 'meta.budget_changed', id, { type: b.type, amountMinor: minor.toString(), currency: cur });
    return { ok: true, amountMinor: minor.toString(), currency: cur, exponent: currencyExponent(cur) };
  });
}
