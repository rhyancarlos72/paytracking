/**
 * checkout-loader.js v2 — InitiateCheckout no CHECKOUT GLOBAL (multi-produto).
 * Porta do checkout-loader-ic-only.js do legado:
 *  1. lê produto_id da URL; 2. pergunta ao tracker qual pixel pertence ao produto
 *     (escopo pela data-key da organização — corrige P-02b);
 *  3. dispara SÓ InitiateCheckout (Pixel + CAPI com o mesmo event_id), sem PageView.
 * Prioridade do event_id: canônico do checkout (window.CHECKOUT_EVENT_IDS) →
 * encaminhado pela página de vendas (?pt_ic_event_id) → gerado.
 * Moeda: a do pixel (antes fixa em BRL — corrige P-26).
 */
import {
  ensureFbc, ensureFbp, fbq, genEventId, getExternalId, getQueryParam, getStoredIc, getUtms, loadFbq,
  readFormPii, send, setStoredIc, testPanel, type Dict,
} from './shared.js';

(function () {
  let self = document.currentScript as HTMLScriptElement | null;
  if (!self) {
    const list = document.querySelectorAll<HTMLScriptElement>('script[src*="checkout-loader"]');
    self = list[list.length - 1] ?? null;
  }
  if (!self?.src) return;
  let base: string;
  try { base = new URL(self.src).origin; } catch { return; }
  const key = self.getAttribute('data-key') ?? '';
  const capturePii = self.getAttribute('data-capture-pii') !== '0';
  const productId = getQueryParam('produto_id') || getQueryParam('product_id') || getQueryParam('offer_id') || getQueryParam('product_sku');
  if (!productId) return;
  const log = testPanel(/[?&]pt_test=1(?:&|$)/.test(location.search), 'PayTracking • checkout');

  const canonicalId = (): string => {
    try {
      const src = (window as any).CHECKOUT_EVENT_IDS || (window as any).PaytrackCheckoutEventIds || {};
      const id = String(src.initiate_checkout || src.initiateCheckout || '').trim();
      if (/^[\w.:-]{8,128}$/.test(id)) return id;
      const el = document.getElementById('initiate-checkout-event-id') as HTMLInputElement | null;
      return el?.value && /^[\w.:-]{8,128}$/.test(el.value.trim()) ? el.value.trim() : '';
    } catch { return ''; }
  };
  const forwardedId = (): string => {
    const id = (getQueryParam('pt_ic_event_id') || getQueryParam('paytrack_ic_event_id')).trim();
    return /^[\w.:-]{8,128}$/.test(id) ? id : '';
  };
  const checkoutValue = (): number | null => {
    let raw = getQueryParam('valor') || getQueryParam('price') || getQueryParam('amount') || getQueryParam('value') || getQueryParam('preco');
    if (!raw) {
      const el = document.getElementById('product-price') || document.querySelector('.total-pedido,[data-paytrack-value],[data-checkout-value]');
      raw = el ? el.getAttribute('data-paytrack-value') || el.getAttribute('data-checkout-value') || el.textContent || '' : '';
    }
    let c = String(raw).replace(/[^\d.,]/g, '');
    if (!c) return null;
    c = c.includes(',') && c.lastIndexOf(',') > c.lastIndexOf('.') ? c.replace(/\./g, '').replace(',', '.') : c.replace(/,/g, '');
    const n = parseFloat(c);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const fire = (cfg: Dict) => {
    if (!cfg?.success || !cfg.pixel_id || !cfg.public_key) {
      log(`Sem pixel para produto_id=${productId}`, 'err');
      return;
    }
    const pixelId = String(cfg.pixel_id);
    const publicKey = String(cfg.public_key);
    const currency = /^[A-Z]{3}$/.test(String(cfg.currency)) ? String(cfg.currency) : 'BRL';
    const endpoint = String(cfg.endpoint || base + '/v1/collect');
    const w = window as any;
    w.__ptLoaded = w.__ptLoaded || {};
    if (w.__ptLoaded[pixelId]) return;
    w.__ptLoaded[pixelId] = true;
    if (getStoredIc(pixelId) && !forwardedId()) {
      log('InitiateCheckout suprimido (já disparado para este pixel)', 'info');
      return;
    }
    const eventId = canonicalId() || forwardedId() || genEventId();
    setStoredIc(pixelId, eventId);

    loadFbq();
    const pii = readFormPii(capturePii);
    const am: Dict = { external_id: getExternalId() };
    if (typeof pii.email === 'string') am.em = pii.email.trim().toLowerCase();
    if (typeof pii.phone === 'string') am.ph = pii.phone.replace(/\D+/g, '');
    if (typeof pii.first_name === 'string') am.fn = pii.first_name.trim().toLowerCase();
    if (typeof pii.last_name === 'string') am.ln = pii.last_name.trim().toLowerCase();
    fbq('init', pixelId, am);
    const value = checkoutValue();
    const params: Dict = value !== null ? { value, currency } : {};
    fbq('trackSingle', pixelId, 'InitiateCheckout', params, { eventID: eventId });
    log(`Pixel InitiateCheckout ${eventId}${value !== null ? ` • ${currency} ${value}` : ''}`, 'ok');

    // pequena janela (≤2,5 s) para capturar PII do formulário sem atrasar o par da CAPI
    const started = Date.now();
    let sent = false;
    const attempt = (force: boolean) => {
      if (sent) return;
      const p = readFormPii(capturePii);
      if (force || p.email || p.phone || p.document || Date.now() - started >= 2500) {
        sent = true;
        const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(publicKey);
        send(url, {
          event: 'checkout', event_id: eventId, event_source_url: location.href, fbp: ensureFbp(), fbc: ensureFbc(),
          external_id: getExternalId(), referrer: document.referrer || '', ...getUtms(), ...p, ...params,
        });
        return;
      }
      setTimeout(() => attempt(false), 400);
    };
    addEventListener('pagehide', () => attempt(true), { capture: true, once: true });
    setTimeout(() => attempt(false), 150);
  };

  const url = `${base}/v1/pixel-config?produto_id=${encodeURIComponent(productId)}${key ? `&key=${encodeURIComponent(key)}` : ''}`;
  fetch(url, { credentials: 'omit' })
    .then((r) => r.json())
    .then(fire)
    .catch(() => log('Falha ao buscar a configuração do pixel', 'err'));
})();
