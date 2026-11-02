/*
 * utms.js — PayTracking. Vai na página de vendas: guarda as UTMs do anúncio (último clique) e as
 * repassa para TODOS os links da página (checkout da Hotmart/Kiwify/…, próxima página, botões
 * criados depois), para a venda chegar com a campanha certa. Sem cookies de terceiros, sem rede.
 *
 *   <script src="https://SEU_PAINEL/utms.js" async defer></script>
 *
 * Opções (atributos no <script>):
 *   data-xcod-sck="1"      também preenche xcod/sck (Hotmart) com as UTMs — DESLIGADO por padrão:
 *                          o pixel.js do PayTracking já monta o xcod com o id do visitante (melhor).
 *   data-only="a.com,b.com" decora só links desses domínios (padrão: todos).
 */
import { getUtms } from './shared';

declare global { interface Window { ptUtms?: { params: Record<string, string>; decorate: (root?: ParentNode) => void } } }

(function () {
  if (window.ptUtms) return; // incluído duas vezes
  const script = document.currentScript as HTMLScriptElement | null;
  const opt = (k: string) => script?.getAttribute(k) ?? null;
  const withXcod = opt('data-xcod-sck') === '1';
  const only = (opt('data-only') ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  // links que não podem receber parâmetros extras (mensagem pronta do WhatsApp, telefone, e-mail…)
  const SKIP_HOSTS = /(^|\.)(wa\.me|whatsapp\.com|t\.me)$/i;

  const clean = (v: string | null | undefined) => {
    const s = (v ?? '').trim();
    // macro da Meta sem valor (pré-visualização do anúncio) não é campanha
    return s && !/\{\{|%7B%7B/i.test(s) ? s.slice(0, 500) : '';
  };
  const params: Record<string, string> = {};
  const utms = getUtms();
  for (const k of Object.keys(utms)) { const v = clean(utms[k]); if (v) params[k] = v; }
  const q = new URLSearchParams(location.search);
  for (const k of ['src', 'fbclid', 'gclid', 'ttclid']) { const v = clean(q.get(k)); if (v) params[k] = v; }
  if (withXcod) {
    const code = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'].filter((k) => params[k]).map((k) => `${k}=${encodeURIComponent(params[k]!)}`).join('&').slice(0, 240);
    if (code) { params.xcod = code; params.sck = code; }
  }
  const keys = Object.keys(params);

  function decorateLink(a: HTMLAnchorElement) {
    if (!keys.length) return;
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|sms|data):/i.test(raw)) return;
    let u: URL;
    try { u = new URL(raw, location.href); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const host = u.hostname.toLowerCase();
    if (SKIP_HOSTS.test(host)) return;
    if (only.length && !only.some((d) => host === d || host.endsWith('.' + d))) return;
    // âncora na própria página (mesmo endereço + #seção): não mexe
    if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && u.hash) return;
    let changed = false;
    for (const k of keys) {
      if (!u.searchParams.has(k)) { u.searchParams.set(k, params[k]!); changed = true; } // nunca sobrescreve o que o link já tem
    }
    if (changed) a.setAttribute('href', u.toString());
  }

  function decorate(root: ParentNode = document) {
    root.querySelectorAll?.('a[href]').forEach((a) => decorateLink(a as HTMLAnchorElement));
  }

  // links criados depois (construtores de página, popups, botões que aparecem com atraso)
  let pending = false;
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; decorate(); }, 50);
  }) : null;

  // garantia no clique: mesmo que o href tenha sido trocado por outro script logo antes
  const onPress = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a) decorateLink(a);
  };
  for (const ev of ['mousedown', 'touchstart', 'keydown', 'click']) document.addEventListener(ev, onPress, { capture: true, passive: true });

  const start = () => {
    decorate();
    mo?.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.ptUtms = { params, decorate };
})();
