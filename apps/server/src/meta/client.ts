import { createHmac } from 'node:crypto';
import type { Ctx } from '../context.js';

/**
 * Cliente da Meta Graph/Marketing API (porta de app/MetaAds.php).
 * - token no header Authorization (nunca na URL);
 * - appsecret_proof quando META_APP_SECRET está configurado;
 * - paginação completa (paging.next) com limite de segurança;
 * - erros tipados: token inválido/expirado (190) e rate limit (4/17/32/613/80004).
 */

export class MetaApiError extends Error {
  constructor(message: string, public readonly code: number | null, public readonly httpStatus: number, public readonly fbtraceId?: string) {
    super(message);
  }
  get isTokenError() { return this.code === 190 || this.code === 102; }
  get isRateLimit() { return this.code !== null && [4, 17, 32, 613, 80000, 80003, 80004].includes(this.code); }
  get isPermission() { return this.code === 10 || this.code === 200 || (this.code !== null && this.code >= 200 && this.code < 300); }
}

export interface MetricRow {
  spend: string;
  impressions: number;
  clicks: number;
  linkClicks: number;
  /** pessoas que clicaram no link (cada pessoa conta uma vez) */
  uniqueLinkClicks: number;
  landingPageViews: number;
  purchases: number;
  revenue: string;
  ctr: number;
  cpc: string;
  currency: string | null;
}

const INSIGHT_FIELDS = 'spend,impressions,clicks,inline_link_clicks,unique_inline_link_clicks,ctr,cpc,actions,action_values,account_currency';

/** Um único action_type canônico — sem contar a mesma compra 3-4x (legado: extractPurchase). */
export function extractPurchase(actions: unknown): number {
  const map = new Map<string, number>();
  for (const a of Array.isArray(actions) ? actions : []) if (a?.action_type) map.set(String(a.action_type), Number(a.value ?? 0));
  for (const t of ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase', 'web_in_store_purchase']) {
    if (map.has(t)) return map.get(t)!;
  }
  return 0;
}

export function extractAction(actions: unknown, type: string): number {
  for (const a of Array.isArray(actions) ? actions : []) if (a?.action_type === type) return Number(a.value ?? 0);
  return 0;
}

export function metricsFromInsight(i: Record<string, any> | undefined): MetricRow {
  const x = i ?? {};
  return {
    spend: String(x.spend ?? '0'),
    impressions: Number(x.impressions ?? 0),
    clicks: Number(x.clicks ?? 0),
    linkClicks: Number(x.inline_link_clicks ?? 0),
    uniqueLinkClicks: Number(x.unique_inline_link_clicks ?? 0),
    landingPageViews: extractAction(x.actions, 'landing_page_view'),
    purchases: extractPurchase(x.actions),
    revenue: String(extractPurchase(x.action_values)),
    ctr: Number(x.ctr ?? 0),
    cpc: String(x.cpc ?? '0'),
    currency: x.account_currency ? String(x.account_currency).toUpperCase() : null,
  };
}

export class MetaClient {
  constructor(private readonly ctx: Ctx, private readonly token: string) {}

  private get base() {
    return `${this.ctx.config.META_GRAPH_BASE_URL}/${this.ctx.config.META_GRAPH_VERSION}`;
  }

  private withProof(params: URLSearchParams) {
    if (this.ctx.config.META_APP_SECRET) {
      params.set('appsecret_proof', createHmac('sha256', this.ctx.config.META_APP_SECRET).update(this.token).digest('hex'));
    }
  }

  private async request(method: 'GET' | 'POST', urlOrPath: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(urlOrPath.startsWith('http') ? urlOrPath : this.base + urlOrPath);
    const body = new URLSearchParams();
    const target = method === 'GET' ? url.searchParams : body;
    for (const [k, v] of Object.entries(params)) target.set(k, v);
    if (!url.searchParams.has('appsecret_proof')) this.withProof(method === 'GET' ? url.searchParams : body);
    let res: Response;
    try {
      res = await this.ctx.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new MetaApiError(`Falha de conexão com a Meta: ${(e as Error).message}`, null, 0);
    }
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.error) {
      const err = json?.error ?? {};
      throw new MetaApiError(String(err.error_user_msg ?? err.message ?? `HTTP ${res.status}`), typeof err.code === 'number' ? err.code : null, res.status, err.fbtrace_id);
    }
    return json;
  }

  async getAll(path: string, params: Record<string, string>, maxPages = 50): Promise<any[]> {
    const first = await this.request('GET', path, params);
    const data: any[] = [...(first.data ?? [])];
    let next: string | undefined = first.paging?.next;
    for (let i = 0; next && i < maxPages; i++) {
      const page = await this.request('GET', next);
      data.push(...(page.data ?? []));
      next = page.paging?.next;
    }
    return data;
  }

  me() {
    return this.request('GET', '/me', { fields: 'id,name' });
  }

  async permissions(): Promise<string[]> {
    const r = await this.request('GET', '/me/permissions');
    return (r.data ?? []).filter((p: any) => p.status === 'granted').map((p: any) => String(p.permission));
  }

  adAccounts() {
    return this.getAll('/me/adaccounts', { fields: 'account_id,name,account_status,currency,timezone_name', limit: '200' });
  }

  /** Insights diários da conta (inclui campanhas excluídas/arquivadas — bate com o Gerenciador). */
  accountInsightsDaily(accountId: string, since: string, until: string) {
    return this.getAll(`/${accountId}/insights`, {
      level: 'account', time_increment: '1', fields: `${INSIGHT_FIELDS},date_start`,
      time_range: JSON.stringify({ since, until }), limit: '500',
    });
  }

  campaigns(accountId: string, since: string, until: string) {
    return this.getAll(`/${accountId}/campaigns`, {
      fields: `id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){${INSIGHT_FIELDS}}`,
      limit: '200',
    });
  }

  adsets(accountId: string, since: string, until: string, campaignIds: string[] = []) {
    const params: Record<string, string> = {
      fields: `id,name,status,effective_status,campaign_id,campaign{name},daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){${INSIGHT_FIELDS}}`,
      limit: '500',
    };
    if (campaignIds.length) params.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]);
    return this.getAll(`/${accountId}/adsets`, params);
  }

  updateStatus(id: string, status: 'ACTIVE' | 'PAUSED') {
    return this.request('POST', `/${id}`, { status });
  }

  /**
   * Duplica campanha (com conjuntos e anúncios) ou conjunto (com anúncios), em ETAPAS: a Meta só aceita
   * a "cópia completa" (deep_copy) num pedido só com até 3 itens — acima disso recusa, e era por isso que
   * duplicar não funcionava em campanhas maiores. Aqui: copia o item de cima já ATIVO, depois cada filho
   * apontando para a cópia (mantendo o status de origem: o que estava pausado continua pausado).
   * Itens excluídos/arquivados não são copiados. Pode ser repetido quantas vezes quiser.
   */
  async duplicate(id: string, type: 'campaign' | 'adset'): Promise<{ newId: string; adsets: number; ads: number; failed: number; firstError: string | null }> {
    const top = await this.request('POST', `/${id}/copies`, { status_option: 'ACTIVE', deep_copy: 'false' });
    const newId = String(top?.copied_campaign_id ?? top?.copied_adset_id ?? top?.id ?? '');
    if (!newId) throw new MetaApiError('A Meta não devolveu o ID da cópia.', null, 0);
    const live = (rows: any[]) => rows.filter((x) => !['DELETED', 'ARCHIVED'].includes(String(x?.effective_status ?? x?.status ?? '').toUpperCase()));
    const out = { newId, adsets: 0, ads: 0, failed: 0, firstError: null as string | null };
    const fail = (e: unknown) => { out.failed++; out.firstError ??= (e as Error).message; };
    const copyAds = async (fromAdset: string, toAdset: string) => {
      const ads = live(await this.getAll(`/${fromAdset}/ads`, { fields: 'id,effective_status', limit: '200' }, 5));
      for (const ad of ads) {
        try {
          await this.request('POST', `/${ad.id}/copies`, { adset_id: toAdset, status_option: 'INHERITED_FROM_SOURCE' });
          out.ads++;
        } catch (e) {
          // anúncios antigos com campos de criativo que a Meta descontinuou (ex.: "aprimoramentos padrão")
          // não podem ser copiados como estão: cria o anúncio no conjunto novo reaproveitando o MESMO criativo
          try { await this.adFromSameCreative(String(ad.id), toAdset); out.ads++; } catch (e2) { fail(e2 instanceof MetaApiError && e2.httpStatus > 0 ? e2 : e); }
        }
      }
    };
    if (type === 'adset') {
      await copyAds(id, newId);
      return out;
    }
    const adsets = live(await this.getAll(`/${id}/adsets`, { fields: 'id,effective_status', limit: '200' }, 5));
    for (const s of adsets) {
      try {
        const r = await this.request('POST', `/${s.id}/copies`, { campaign_id: newId, deep_copy: 'false', status_option: 'INHERITED_FROM_SOURCE' });
        const nid = String(r?.copied_adset_id ?? r?.id ?? '');
        out.adsets++;
        if (nid) await copyAds(String(s.id), nid);
      } catch (e) { fail(e); }
    }
    return out;
  }

  /** Anúncio novo no conjunto `toAdset` usando o criativo já existente do anúncio `adId` (mesmo nome + " - Cópia", mesmo status). */
  private async adFromSameCreative(adId: string, toAdset: string) {
    const src = await this.request('GET', `/${adId}`, { fields: 'name,status,account_id,creative{id},tracking_specs' });
    const creativeId = src?.creative?.id;
    const account = String(src?.account_id ?? '').replace(/\D+/g, '');
    if (!creativeId || !account) throw new MetaApiError('Não foi possível ler o criativo do anúncio original.', null, 0);
    const params: Record<string, string> = {
      name: `${String(src.name ?? 'Anúncio').slice(0, 380)} - Cópia`,
      adset_id: toAdset,
      creative: JSON.stringify({ creative_id: String(creativeId) }),
      status: String(src.status ?? '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
    };
    if (Array.isArray(src.tracking_specs) && src.tracking_specs.length) params.tracking_specs = JSON.stringify(src.tracking_specs);
    return this.request('POST', `/act_${account}/ads`, params);
  }

  /** Orçamento em unidade mínima da MOEDA DA CONTA (sem conversão — corrige P-25/P-27). */
  updateBudget(id: string, field: 'daily_budget' | 'lifetime_budget', amountMinor: bigint) {
    return this.request('POST', `/${id}`, { [field]: amountMinor.toString() });
  }
}

export function metaAuthUrl(ctx: Ctx, state: string): string {
  const p = new URLSearchParams({
    client_id: ctx.config.META_APP_ID,
    redirect_uri: metaRedirectUri(ctx),
    state,
    response_type: 'code',
  });
  if (ctx.config.META_LOGIN_CONFIG_ID) p.set('config_id', ctx.config.META_LOGIN_CONFIG_ID);
  else p.set('scope', 'ads_read,ads_management');
  return `https://www.facebook.com/${ctx.config.META_GRAPH_VERSION}/dialog/oauth?${p.toString()}`;
}

export const metaRedirectUri = (ctx: Ctx) => `${ctx.config.PUBLIC_API_URL}/v1/meta/callback`;

/** code → token curto → token longo (~60 dias). */
export async function exchangeCode(ctx: Ctx, code: string): Promise<{ token: string; expiresAt: Date | null }> {
  const base = `${ctx.config.META_GRAPH_BASE_URL}/${ctx.config.META_GRAPH_VERSION}/oauth/access_token`;
  const call = async (params: Record<string, string>) => {
    const res = await ctx.fetch(`${base}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || j.error || !j.access_token) {
      throw new MetaApiError(String(j?.error?.message ?? `HTTP ${res.status}`), j?.error?.code ?? null, res.status);
    }
    return j as { access_token: string; expires_in?: number };
  };
  const short = await call({
    client_id: ctx.config.META_APP_ID, client_secret: ctx.config.META_APP_SECRET, redirect_uri: metaRedirectUri(ctx), code,
  });
  let long = short;
  try {
    long = await call({
      grant_type: 'fb_exchange_token', client_id: ctx.config.META_APP_ID, client_secret: ctx.config.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    });
  } catch (e) {
    ctx.log.warn({ err: String(e) }, 'troca por token longo falhou; usando token curto');
  }
  const exp = Number(long.expires_in ?? 0);
  return { token: long.access_token, expiresAt: exp > 0 ? new Date(ctx.now().getTime() + exp * 1000) : null };
}

export const normalizeAccountId = (id: string): string => {
  const t = id.trim();
  return t.startsWith('act_') ? t : `act_${t.replace(/\D+/g, '')}`;
};
