import type { Ctx } from '../context.js';
import { MetaApiError, MetaClient } from './client.js';

/**
 * Chamadas de teste para a revisão do app na Meta: antes de liberar o "acesso avançado", a Meta exige pelo menos
 * 1 chamada bem-sucedida com cada permissão nos últimos 30 dias. Rodam quando o ADMIN DA PLATAFORMA conecta o
 * Meta Ads (e pelo botão no Admin) — nunca para os clientes.
 *
 * Só leitura, com UMA exceção segura para ads_management: reenviar status "PAUSED" a uma campanha que JÁ está
 * pausada (nada muda na conta). Sem campanha pausada, a escrita é pulada e fica registrado o porquê.
 */
export const REVIEW_SCOPES = ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement'] as const;
export type ReviewPermission = (typeof REVIEW_SCOPES)[number];

export interface ReviewCall { permission: ReviewPermission; ok: boolean; call: string; detail: string }
export interface ReviewResult { at: string; granted: string[]; calls: ReviewCall[] }

const msg = (e: unknown) => (e instanceof MetaApiError ? `${e.message}${e.code ? ` (código ${e.code})` : ''}` : (e as Error).message).slice(0, 300);

export async function runReviewCalls(ctx: Ctx, token: string): Promise<ReviewResult> {
  const me = new MetaClient(ctx, token);
  const granted = await me.permissions().catch(() => [] as string[]);
  const calls: ReviewCall[] = [];
  const has = (p: string) => granted.includes(p);
  const missing = (permission: ReviewPermission, call: string) =>
    calls.push({ permission, ok: false, call, detail: 'O Facebook não concedeu esta permissão. Desconecte o Meta Ads, conecte de novo e, na janela do Facebook, clique em "Editar acesso"/"Escolher o que permitir" e deixe TUDO marcado (inclusive a sua Página). Se ela nem aparecer na janela, a permissão não está adicionada ao app no painel da Meta (Casos de uso → Personalizar).' });

  // ads_read: contas de anúncios do usuário
  let accountId: string | null = null;
  if (!has('ads_read')) missing('ads_read', 'GET /me/adaccounts');
  else {
    try {
      const accts = await me.adAccounts();
      accountId = accts[0] ? `act_${accts[0].account_id}` : null;
      calls.push({ permission: 'ads_read', ok: true, call: 'GET /me/adaccounts', detail: `${accts.length} conta(s) de anúncios lida(s)` });
    } catch (e) { calls.push({ permission: 'ads_read', ok: false, call: 'GET /me/adaccounts', detail: msg(e) }); }
  }

  // ads_management: escrita sem efeito (status PAUSED numa campanha já pausada)
  if (!has('ads_management')) missing('ads_management', 'POST /{campanha} status=PAUSED');
  else if (!accountId) calls.push({ permission: 'ads_management', ok: false, call: 'POST /{campanha}', detail: 'Nenhuma conta de anúncios encontrada no perfil conectado.' });
  else {
    try {
      const camps = await me.getAll(`/${accountId}/campaigns`, { fields: 'id,name,status', limit: '100' }, 2);
      const paused = camps.find((c) => c.status === 'PAUSED');
      if (paused) {
        await me.post(`/${paused.id}`, { status: 'PAUSED' });
        calls.push({ permission: 'ads_management', ok: true, call: `POST /${paused.id} status=PAUSED`, detail: `Campanha "${String(paused.name).slice(0, 60)}" já estava pausada — nada mudou.` });
      } else {
        calls.push({ permission: 'ads_management', ok: true, call: `GET /${accountId}/campaigns`, detail: 'Leitura das campanhas feita com o token de gerenciamento. Para a chamada de escrita, deixe ao menos 1 campanha PAUSADA na conta e rode de novo.' });
      }
    } catch (e) { calls.push({ permission: 'ads_management', ok: false, call: `${accountId}/campaigns`, detail: msg(e) }); }
  }

  // pages_show_list + pages_read_engagement: Páginas do perfil e dados básicos da primeira (com o token da Página)
  let page: { id: string; name: string; access_token?: string } | null = null;
  if (!has('pages_show_list')) missing('pages_show_list', 'GET /me/accounts');
  else {
    try {
      const pages = await me.getAll('/me/accounts', { fields: 'id,name,access_token', limit: '50' }, 1);
      page = pages[0] ?? null;
      calls.push({ permission: 'pages_show_list', ok: true, call: 'GET /me/accounts', detail: `${pages.length} Página(s) encontrada(s)` });
    } catch (e) { calls.push({ permission: 'pages_show_list', ok: false, call: 'GET /me/accounts', detail: msg(e) }); }
  }
  if (!has('pages_read_engagement')) missing('pages_read_engagement', 'GET /{página}?fields=name,followers_count');
  else if (!page) calls.push({ permission: 'pages_read_engagement', ok: false, call: 'GET /{página}', detail: 'Nenhuma Página do Facebook no perfil conectado (é preciso administrar ao menos uma Página).' });
  else {
    try {
      const pc = new MetaClient(ctx, page.access_token || token);
      const info = await pc.get(`/${page.id}`, { fields: 'name,followers_count,fan_count' });
      calls.push({ permission: 'pages_read_engagement', ok: true, call: `GET /${page.id}?fields=name,followers_count`, detail: `Página "${String(info.name ?? page.name).slice(0, 60)}" lida` });
    } catch (e) { calls.push({ permission: 'pages_read_engagement', ok: false, call: `GET /${page.id}`, detail: msg(e) }); }
  }

  return { at: new Date().toISOString(), granted, calls };
}

export async function saveReviewResult(ctx: Ctx, r: ReviewResult) {
  await ctx.db.query(
    `INSERT INTO app_settings(key, value, updated_at) VALUES ('meta_review_calls', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(r)],
  );
}

export async function loadReviewResult(ctx: Ctx): Promise<ReviewResult | null> {
  const r = await ctx.db.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'meta_review_calls'`);
  try { return r.rows[0] ? JSON.parse(r.rows[0].value) : null; } catch { return null; }
}
