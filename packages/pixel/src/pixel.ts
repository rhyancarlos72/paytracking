/**
 * PayTracking pixel.js v2 — Pixel da Meta + ponte para a CAPI com o MESMO event_id.
 * Compatível com os snippets do legado (mesmos atributos data-*):
 *   data-key, data-pixel-id, data-endpoint, data-currency, data-country,
 *   data-ic-click, data-ic-rule, data-ic-value, data-ic-selector, data-ic-onload,
 *   data-ic-auto-text, data-ic-price, data-content-id, data-content-name, data-ic-url-pattern,
 *   data-test, data-token (legado), data-capture-pii (novo, padrão "1"), data-auto-config ("0" desliga os eventos automáticos da Meta).
 * Regras preservadas: PageView em todo carregamento; IC só por clique OU no checkout;
 * Purchase nunca pelo navegador; supressão de IC de 5 min por pixel; decoração de links
 * com pt_ic_event_id, pt_fbc, fbclid, UTMs, src e xcod/sck (≤240 caracteres).
 */
import {
  ensureFbc, ensureFbp, fbq, genEventId, getCookie, getExternalId, getQueryParam, getStoredIc, getUtms,
  loadFbq, readFormPii, send, setCookie, setStoredIc, sha256, testPanel, type Dict,
} from './shared.js';

(function () {
  let script = document.currentScript as HTMLScriptElement | null;
  if (!script || !script.getAttribute('data-pixel-id')) {
    const list = document.querySelectorAll<HTMLScriptElement>('script[data-pixel-id][data-endpoint]');
    script = list[list.length - 1] ?? script;
  }
  if (!script) return;
  const attr = (n: string) => script!.getAttribute(n) ?? '';
  const PIXEL_ID = attr('data-pixel-id');
  const ENDPOINT = attr('data-endpoint');
  const PUBLIC_KEY = attr('data-key');
  const LEGACY_TOKEN = attr('data-token');
  const KEY = PUBLIC_KEY || LEGACY_TOKEN;
  let CURRENCY = (attr('data-currency') || 'BRL').toUpperCase();
  if (!/^[A-Z]{3}$/.test(CURRENCY)) CURRENCY = 'BRL';
  const CAPTURE_PII = attr('data-capture-pii') !== '0';
  const IC_RULE = attr('data-ic-rule') || 'none';
  const IC_VALUE = attr('data-ic-value');
  const IC_SELECTOR = attr('data-ic-selector');
  const IC_ONLOAD = attr('data-ic-onload') === '1';
  const IC_CLICK = !IC_ONLOAD && (IC_RULE !== 'none' || IC_SELECTOR !== '' || attr('data-ic-click') === '1');
  const IC_AUTO_TEXT = attr('data-ic-auto-text') !== '0';
  const IC_TEXT_RE = /\b(comprar|compre|compra|finalizar|finalize|checkout|pagar|pagamento|adquirir|assinar|quero|garantir|garanta|prosseguir)\b/i;
  const IC_PRICE = parseFloat(attr('data-ic-price').replace(',', '.'));
  const CONTENT_ID = attr('data-content-id');
  const CONTENT_NAME = attr('data-content-name');
  let IC_URL_RE: RegExp;
  try {
    IC_URL_RE = new RegExp(attr('data-ic-url-pattern') || '([?&](ref|aff|afid|src|xcod)=|/checkout|/pay|/c/|produto_id=|product_id=|/pagamento)', 'i');
  } catch {
    IC_URL_RE = /([?&]ref=|\/checkout|\/pay)/i;
  }
  const TEST = attr('data-test') === '1' || /[?&]pt_test=1(?:&|$)/.test(location.search);
  const log = testPanel(TEST, 'PayTracking • teste de eventos');

  if (!PIXEL_ID || !ENDPOINT || !KEY) {
    console.warn('[paytracking] faltam data-pixel-id, data-endpoint ou data-key');
    return;
  }

  // ---- Pixel oficial + Advanced Matching com o MESMO external_id hasheado da CAPI
  loadFbq();
  const matchData = (): Dict => {
    const m: Dict = {};
    const xid = getExternalId();
    if (xid) m.external_id = sha256(xid.trim().toLowerCase());
    const pii = readFormPii(CAPTURE_PII);
    if (typeof pii.email === 'string' && pii.email.includes('@')) m.em = pii.email.trim().toLowerCase();
    if (typeof pii.first_name === 'string') m.fn = pii.first_name.trim().toLowerCase();
    if (typeof pii.last_name === 'string') m.ln = pii.last_name.trim().toLowerCase();
    return m;
  };
  try {
    setCookie('pt_ua', navigator.userAgent || '');
  } catch { /* */ }
  ensureFbp();
  ensureFbc();
  // data-auto-config="0": desliga os "eventos automáticos" da Meta (leitura de botões e dados da página)
  if (attr('data-auto-config') === '0') fbq('set', 'autoConfig', false, PIXEL_ID);
  let lastInit = JSON.stringify(matchData());
  fbq('init', PIXEL_ID, JSON.parse(lastInit));

  const trackPixel = (eventName: string, params: Dict, eventId: string) => {
    if (eventName === 'PageView') {
      delete params.currency;
      delete params.value;
    } else if (!params.currency) params.currency = CURRENCY;
    const md = JSON.stringify(matchData());
    if (md !== lastInit) {
      lastInit = md;
      fbq('init', PIXEL_ID, JSON.parse(md));
    }
    // trackSingle: nunca "vaza" para outros pixels inicializados na mesma página
    fbq('trackSingle', PIXEL_ID, eventName, params, { eventID: eventId });
  };

  const sendToServer = (event: string, eventId: string, extra: Dict = {}) => {
    const payload: Dict = {
      event, event_id: eventId, event_source_url: location.href,
      fbp: ensureFbp(), fbc: ensureFbc(), external_id: getExternalId(), referrer: document.referrer || '',
      ...getUtms(), ...readFormPii(CAPTURE_PII), ...extra,
    };
    if (event === 'page_view') {
      delete payload.currency;
      delete payload.value;
    } else if (!payload.currency) payload.currency = CURRENCY;
    const url = ENDPOINT + (ENDPOINT.includes('?') ? '&' : '?') + (PUBLIC_KEY ? 'k=' : 't=') + encodeURIComponent(KEY);
    send(url, payload, {
      beaconFirst: event === 'checkout' && !TEST, // o clique navega: beacon sobrevive à troca de página
      onResult: TEST ? (ok, j) => log(`CAPI ${event} → ${ok ? (j?.duplicate ? 'duplicado (ok)' : 'enfileirado ✓') : String(j?.error ?? 'falha')}`, ok ? 'ok' : 'err') : undefined,
    });
  };

  // ---- PageView
  const pvId = genEventId();
  trackPixel('PageView', {}, pvId);
  log(`Pixel ${PIXEL_ID} • PageView ${pvId}`, 'ok');
  sendToServer('page_view', pvId);

  // ---- InitiateCheckout
  const absolute = (u: string) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  const matchesRule = (target: string) => {
    if (IC_RULE === 'none' || !IC_VALUE || !target) return false;
    if (IC_RULE === 'contains') return target.includes(IC_VALUE);
    if (IC_RULE === 'equals') return target.replace(/\/$/, '') === IC_VALUE.replace(/\/$/, '');
    if (IC_RULE === 'starts_with') return target.startsWith(IC_VALUE);
    return false;
  };

  /** Leva atribuição/identidade até checkouts de outro domínio (Hotmart & cia devolvem xcod/sck). */
  const decorate = (url: string, eventId: string): string => {
    try {
      const u = new URL(url, location.href);
      if (eventId && !u.searchParams.get('pt_ic_event_id')) u.searchParams.set('pt_ic_event_id', eventId);
      const fbc = ensureFbc();
      if (fbc && !u.searchParams.get('pt_fbc') && !u.searchParams.get('_fbc')) u.searchParams.set('pt_fbc', fbc);
      const fbclid = getQueryParam('fbclid');
      if (fbclid && !u.searchParams.get('fbclid')) u.searchParams.set('fbclid', fbclid);
      const utms = getUtms();
      for (const [k, v] of Object.entries(utms)) if (v && !u.searchParams.get(k)) u.searchParams.set(k, v);
      if (utms.utm_source && !u.searchParams.get('src')) u.searchParams.set('src', utms.utm_source);
      // ordem de prioridade (o código tem no máximo 240 caracteres): primeiro o external_id (ponte de
      // identidade: o servidor recupera UTMs, fbp e fbc do visitante), depois a campanha/conjunto/anúncio;
      // fbp e o fbclid (que costuma ser enorme) por último — o servidor também os recupera pela ponte
      const parts: string[] = [];
      const xid = getExternalId();
      if (xid) parts.push('external_id=' + encodeURIComponent(xid));
      for (const k of ['utm_campaign', 'utm_medium', 'utm_content', 'utm_source', 'utm_term', 'utm_id']) {
        if (utms[k]) parts.push(k + '=' + encodeURIComponent(utms[k]!));
      }
      const fbp = getCookie('_fbp');
      if (fbp) parts.push('fbp=' + encodeURIComponent(fbp));
      if (fbclid) parts.push('fbclid=' + encodeURIComponent(fbclid));
      // nunca corta um valor no meio: descarta partes inteiras ao estourar o limite
      const kept: string[] = [];
      let used = 0;
      for (const p of parts) {
        const add = p.length + (kept.length ? 1 : 0);
        if (used + add <= 240) { kept.push(p); used += add; }
      }
      const code = kept.join('&');
      if (code) {
        if (!u.searchParams.get('xcod')) u.searchParams.set('xcod', code);
        if (!u.searchParams.get('sck')) u.searchParams.set('sck', code);
      }
      return u.href;
    } catch {
      return url;
    }
  };

  const forward = (target: Element, eventId: string) => {
    const carrier = target.closest('[data-paytrack-checkout-url],[data-checkout-url],[data-href],[data-url]');
    if (carrier) {
      for (const a of ['data-paytrack-checkout-url', 'data-checkout-url', 'data-href', 'data-url']) {
        const v = carrier.getAttribute(a);
        if (v) carrier.setAttribute(a, decorate(v, eventId));
      }
    }
    const link = target.closest('a[href]');
    if (link) { link.setAttribute('href', decorate(link.getAttribute('href') ?? '', eventId)); return; }
    const form = target.closest('form[action]');
    if (form) form.setAttribute('action', decorate(form.getAttribute('action') ?? '', eventId));
  };

  const MANUAL = '__manual__';
  const checkoutTarget = (target: Element): string => {
    const forced = target.closest('[data-pt-checkout],[data-paytrack-checkout],[data-paytrack-ic]');
    if (forced) {
      const u = ['data-paytrack-checkout-url', 'data-checkout-url', 'data-href', 'data-url', 'href'].map((a) => forced.getAttribute(a)).find(Boolean);
      return u ? absolute(u) : MANUAL;
    }
    const manual = target.closest('[data-paytrack-checkout-url],[data-checkout-url],[data-href],[data-url]');
    if (manual) {
      const u = ['data-paytrack-checkout-url', 'data-checkout-url', 'data-href', 'data-url'].map((a) => manual.getAttribute(a)).find(Boolean);
      if (u) return absolute(u);
    }
    const link = target.closest('a[href]');
    const form = target.closest('form[action]');
    // âncora na mesma página (#secao) ou javascript: não é ida ao checkout
    const rawHref = link?.getAttribute('href') ?? '';
    if (link && /^(#|javascript:)/i.test(rawHref.trim())) return '';
    const dest = link ? absolute(rawHref) : form ? absolute(form.getAttribute('action') ?? '') : '';
    if (dest && IC_RULE !== 'none' && IC_VALUE) return dest;
    if (dest && IC_URL_RE.test(dest)) return dest;
    const clickable = target.closest('a[href],button,[role="button"],input[type="submit"],input[type="button"]') ?? (IC_SELECTOR ? target.closest(IC_SELECTOR) : null);
    if (!clickable) return '';
    if (IC_SELECTOR && clickable.matches(IC_SELECTOR)) return dest || MANUAL;
    if (IC_AUTO_TEXT) {
      const href = link?.getAttribute('href') ?? '';
      if (href.startsWith('#') || /^javascript:/i.test(href)) return '';
      const el = clickable as HTMLInputElement;
      const txt = (el.value || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length <= 60 && IC_TEXT_RE.test(txt)) return dest || MANUAL;
    }
    return '';
  };

  const fireIc = (checkoutUrl: string, forcedId?: string) => {
    if (getStoredIc(PIXEL_ID) && !forcedId) {
      log('InitiateCheckout suprimido (janela de 5 min)', 'info');
      return;
    }
    const id = forcedId ?? genEventId();
    setStoredIc(PIXEL_ID, id);
    const params: Dict = checkoutUrl ? { checkout_url: checkoutUrl } : {};
    const extra: Dict = { ...params };
    if (IC_PRICE > 0) Object.assign(params, { value: IC_PRICE, currency: CURRENCY }), Object.assign(extra, { value: IC_PRICE, currency: CURRENCY });
    if (CONTENT_ID) {
      Object.assign(params, { content_ids: [CONTENT_ID], content_type: 'product', num_items: 1, ...(CONTENT_NAME ? { content_name: CONTENT_NAME } : {}) });
      extra.products = [{ id: CONTENT_ID, name: CONTENT_NAME || undefined, quantity: 1, price: IC_PRICE > 0 ? IC_PRICE : undefined }];
    }
    trackPixel('InitiateCheckout', params, id);
    log(`Pixel InitiateCheckout ${id}`, 'ok');
    sendToServer('checkout', id, extra);
  };

  let lastClick = 0;
  const onClick = (ev: Event) => {
    const t = ev.target as Element | null;
    if (!t?.closest) return;
    const target = checkoutTarget(t);
    if (!target) return;
    if (!IC_CLICK) {
      if (target !== MANUAL) forward(t, ''); // só enriquece o link (sem evento extra)
      return;
    }
    if (IC_RULE !== 'none' && IC_VALUE && target !== MANUAL && !matchesRule(target)) return;
    const now = Date.now();
    if (now - lastClick < 1200) return; // pointerdown + click do mesmo toque
    lastClick = now;
    const stored = getStoredIc(PIXEL_ID);
    if (stored) { forward(t, stored.id); return; }
    const id = genEventId();
    forward(t, id);
    fireIc(target === MANUAL ? '' : target, id);
  };
  document.addEventListener('pointerdown', onClick, true);
  document.addEventListener('click', onClick, true);

  if (IC_ONLOAD && !getStoredIc(PIXEL_ID)) fireIc('');

  // ---- API pública
  const names: Record<string, string> = { page_view: 'PageView', view_content: 'ViewContent', add_to_cart: 'AddToCart', checkout: 'InitiateCheckout', lead: 'Lead', add_payment_info: 'AddPaymentInfo' };
  (window as any).tracker = {
    track(eventName: string, params: Dict = {}) {
      const fbName = names[eventName];
      if (!fbName) {
        console.warn('[paytracking] evento não permitido no navegador:', eventName, '(Purchase só pelo servidor)');
        return null;
      }
      const id = genEventId();
      trackPixel(fbName, { ...params }, id);
      sendToServer(eventName, id, params);
      return id;
    },
  };
})();
