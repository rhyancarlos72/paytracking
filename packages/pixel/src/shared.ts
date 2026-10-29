/* Utilitários compartilhados entre pixel.js e checkout-loader.js (navegador, sem dependências). */

export type Dict = Record<string, unknown>;

/** SHA-256 síncrono (o Pixel precisa do external_id hasheado ANTES do primeiro PageView). */
export function sha256(ascii: string): string {
  const rightRotate = (v: number, a: number) => (v >>> a) | (v << (32 - a));
  const maxWord = 2 ** 32;
  let result = '';
  const words: number[] = [];
  const s = unescape(encodeURIComponent(ascii));
  const bitLength = s.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
      k[primeCounter++] = (candidate ** (1 / 3) * maxWord) | 0;
    }
  }
  let str = s + '\x80';
  while ((str.length % 64) - 56) str += '\x00';
  for (let i = 0; i < str.length; i++) {
    const j = str.charCodeAt(i);
    words[i >> 2] = (words[i >> 2] ?? 0) | (j << (((3 - i) % 4) * 8));
  }
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;
  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const a = hash[0]!;
      const e = hash[4]!;
      const temp1 =
        hash[7]! +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]!) ^ (~e & hash[6]!)) +
        k[i]! +
        (w[i] = i < 16 ? (w[i] ?? 0) : ((w[i - 16] ?? 0) + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + (w[i - 7] ?? 0) + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]!) ^ (a & hash[2]!) ^ (hash[1]! & hash[2]!));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4]! + temp1) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i]! + oldHash[i]!) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i]! >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function getCookie(name: string): string {
  try {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop() ?? '') : '';
  } catch {
    return '';
  }
}

export function setCookie(name: string, value: string, days = 90): void {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${days * 86400};SameSite=Lax${location.protocol === 'https:' ? ';Secure' : ''}`;
  } catch {
    /* cookies bloqueados */
  }
}

export function getQueryParam(name: string): string {
  const m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
  if (!m?.[1]) return '';
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return m[1]; // UTMs com "%" malformado não podem abortar o rastreio
  }
}

export function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function genEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

/** external_id anônimo e estável por navegador (mesma chave do legado: pt_xid). */
export function getExternalId(): string {
  const s = store();
  try {
    let id = s?.getItem('pt_xid') ?? '';
    if (!id) {
      id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xid_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      s?.setItem('pt_xid', id);
    }
    return id;
  } catch {
    return '';
  }
}

/** fbclid novo tem prioridade sobre um _fbc antigo; nunca fabricamos fbc sem fbclid. */
export function ensureFbc(): string {
  const fbc = getCookie('_fbc');
  const fbclid = getQueryParam('fbclid');
  if (fbc && (!fbclid || fbc.split('.').slice(3).join('.') === fbclid)) return fbc;
  if (fbclid) {
    const v = 'fb.1.' + Date.now() + '.' + fbclid;
    setCookie('_fbc', v);
    return v;
  }
  return fbc;
}

export function ensureFbp(): string {
  const fbp = getCookie('_fbp');
  if (/^fb\.\d+\.\d+\.\d+$/.test(fbp)) return fbp;
  const v = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
  setCookie('_fbp', v);
  return v;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];

/** UTMs last-click persistidas (chave legada pt_utms). */
export function getUtms(): Record<string, string> {
  let found: Record<string, string> = {};
  let hasNew = false;
  for (const k of UTM_KEYS) {
    const v = getQueryParam(k);
    if (v) {
      found[k] = v;
      hasNew = true;
    }
  }
  const s = store();
  try {
    if (hasNew) s?.setItem('pt_utms', JSON.stringify(found));
    else {
      const saved = s?.getItem('pt_utms');
      if (saved) found = JSON.parse(saved) || {};
    }
  } catch {
    /* indisponível */
  }
  return found;
}

/**
 * Dados digitados no formulário (e-mail/telefone/nome/CPF).
 * Mudança de privacidade (P-35): ficam só no sessionStorage (somem ao fechar a aba) e
 * podem ser desligados com data-capture-pii="0". Saem do servidor apenas hasheados.
 */
export function readFormPii(capture: boolean): Dict {
  if (!capture) return {};
  const pii: Dict = {};
  try {
    const q = (sel: string) => document.querySelector<HTMLInputElement>(sel);
    const email = q('input[type="email"],input[autocomplete="email"],input[name*="email" i],input[id*="email" i]');
    if (email?.value.includes('@')) pii.email = email.value.trim();
    const phone = q('input[type="tel"],input[autocomplete="tel"],input[name*="phone" i],input[id*="phone" i],input[name*="celular" i],input[name*="whats" i],input[name*="telefone" i]');
    if (phone && phone.value.replace(/\D+/g, '').length >= 8) pii.phone = phone.value.trim();
    const name = q('input[autocomplete="name"],input[name="name" i],input[id="name" i],input[name*="nome" i],input[id*="nome" i],input[name*="fullname" i]');
    if (name && name.value.trim().length >= 2) {
      const parts = name.value.trim().split(/\s+/);
      pii.first_name = parts[0];
      if (parts.length > 1) pii.last_name = parts.slice(1).join(' ');
    }
    const doc = q('input[name*="cpf" i],input[id*="cpf" i],input[name*="documento" i],input[id*="documento" i]');
    const digits = doc?.value.replace(/\D+/g, '') ?? '';
    if (digits.length === 11 || digits.length === 14) pii.document = digits;
  } catch {
    /* DOM indisponível */
  }
  let stored: Dict = {};
  try {
    stored = JSON.parse(sessionStorage.getItem('pt_pii') || '{}') || {};
    if (Object.keys(pii).length) sessionStorage.setItem('pt_pii', JSON.stringify({ ...stored, ...pii }));
    localStorage.removeItem('pt_pii'); // limpa PII persistida por versões antigas
  } catch {
    /* indisponível */
  }
  try { document.cookie = 'pt_pii=;path=/;max-age=0'; } catch { /* */ }
  return { ...stored, ...pii };
}

/** Envio resiliente: fetch keepalive (text/plain evita preflight) com fallback em sendBeacon. */
export function send(url: string, payload: Dict, opts: { beaconFirst?: boolean; onResult?: (ok: boolean, body: Dict | null) => void } = {}): void {
  const body = JSON.stringify(payload);
  const beacon = () => {
    try {
      return !!navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    } catch {
      return false;
    }
  };
  if (opts.beaconFirst && !opts.onResult && beacon()) return;
  let delivered = false;
  const onHide = () => {
    if (!delivered && document.visibilityState === 'hidden') beacon();
  };
  try {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, keepalive: true, credentials: 'omit' })
      .then((r) => r.json().catch(() => null).then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        delivered = true;
        opts.onResult?.(ok, j as Dict | null);
      })
      .catch(() => {
        if (!delivered) beacon();
        opts.onResult?.(false, null);
      });
    document.addEventListener('visibilitychange', onHide, { capture: true, once: true });
  } catch {
    beacon();
  }
}

export function loadFbq(): void {
  const w = window as any;
  if (w.fbq) return;
  const n: any = (w.fbq = function (...args: unknown[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
  });
  if (!w._fbq) w._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  const t = document.createElement('script');
  t.async = true;
  t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = document.getElementsByTagName('script')[0];
  s?.parentNode ? s.parentNode.insertBefore(t, s) : document.head.appendChild(t);
}

export const fbq = (...args: unknown[]) => (window as any).fbq?.(...args);

/** Supressão de InitiateCheckout por pixel (mesma chave/janela do legado: pt_ic_<pixel>, 5 min). */
export const IC_WINDOW_MS = 5 * 60 * 1000;
export function getStoredIc(pixelId: string): { id: string; t: number } | null {
  try {
    const raw = store()?.getItem('pt_ic_' + pixelId);
    const o = raw ? JSON.parse(raw) : null;
    return o?.id && o?.t && Date.now() - o.t <= IC_WINDOW_MS ? o : null;
  } catch {
    return null;
  }
}
export function setStoredIc(pixelId: string, id: string): void {
  try {
    store()?.setItem('pt_ic_' + pixelId, JSON.stringify({ id, t: Date.now() }));
  } catch {
    /* */
  }
}

export function testPanel(enabled: boolean, title: string): (text: string, status?: 'ok' | 'err' | 'info') => void {
  if (!enabled) return () => undefined;
  let box: HTMLDivElement | null = null;
  const queue: Array<[string, string]> = [];
  const row = (text: string, status: string) => {
    const r = document.createElement('div');
    r.style.cssText = 'margin:4px 0;word-break:break-word';
    const dot = document.createElement('span');
    dot.style.color = status === 'ok' ? '#22c55e' : status === 'err' ? '#ef4444' : '#94a3b8';
    dot.textContent = '● ';
    r.appendChild(dot);
    r.appendChild(document.createTextNode(new Date().toLocaleTimeString() + ' ' + text)); // sem innerHTML (XSS)
    box!.appendChild(r);
  };
  const ensure = () => {
    if (box || !document.body) return;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:60vh;overflow:auto;padding:14px;background:rgba(15,23,42,.96);color:#e2e8f0;border:1px solid #334155;border-radius:12px;font:12px/1.5 ui-monospace,Menlo,monospace';
    const h = document.createElement('strong');
    h.style.color = '#38bdf8';
    h.textContent = title;
    box.appendChild(h);
    document.body.appendChild(box);
    queue.splice(0).forEach(([t, s]) => row(t, s));
  };
  return (text, status = 'info') => {
    if (!document.body) {
      queue.push([text, status]);
      document.addEventListener('DOMContentLoaded', ensure, { once: true });
      return;
    }
    ensure();
    row(text, status);
  };
}
