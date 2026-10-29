import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeCurrency, parseAmount, parseTrackingCode, type AmountUnit, type CustomerInput } from '@pt/domain';
import type { NormalizedProduct, NormalizedTracking } from './types.js';

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** Primeiro valor escalar não vazio entre as chaves. */
export function pick(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = k.includes('.') ? k.split('.').reduce<unknown>((acc, part) => obj(acc)[part], o) : o[k];
    if ((typeof v === 'string' && v.trim() !== '') || typeof v === 'number') return String(v).trim();
  }
  return null;
}

export function pickRaw(o: Obj, keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** Comparação em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const hmacHex = (algo: 'sha1' | 'sha256', body: string, secret: string) =>
  createHmac(algo, secret).update(body, 'utf8').digest('hex');

export function currencyOr(raw: unknown, fallback: string): string {
  return normalizeCurrency(raw) ?? fallback;
}

export function amount(raw: unknown, currency: string, unit: AmountUnit): bigint | null {
  const v = parseAmount(raw, currency, unit);
  return v !== null && v >= 0n ? v : null;
}

export function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

export function customerFrom(c: Obj, extra: Partial<CustomerInput> = {}): CustomerInput {
  const addr = obj(c.address);
  const name = pick(c, ['full_name', 'name', 'nome']);
  const split = splitName(name);
  let phone: unknown = c.mobile ?? c.phone ?? c.phone_number ?? c.telephone ?? c.checkout_phone ?? c.celular;
  if (isObj(phone)) phone = `${phone.area_code ?? ''}${phone.number ?? ''}`;
  return {
    email: pick(c, ['email'])?.toLowerCase() ?? null,
    phone: typeof phone === 'string' || typeof phone === 'number' ? String(phone) : null,
    firstName: pick(c, ['first_name']) ?? split.firstName,
    lastName: pick(c, ['last_name']) ?? split.lastName,
    document: pick(c, ['CPF', 'cpf', 'document', 'doc', 'tax_id', 'cnpj']) ?? pick(obj(c.documents), ['document']),
    city: pick(c, ['city', 'cidade']) ?? pick(addr, ['city', 'cidade']),
    state: pick(c, ['state', 'estado', 'uf']) ?? pick(addr, ['state', 'estado', 'uf']),
    zip: pick(c, ['zipcode', 'zip', 'zip_code', 'cep']) ?? pick(addr, ['zipcode', 'zip_code', 'zip', 'cep']),
    country: pick(c, ['country_iso', 'country']) ?? pick(addr, ['country_iso', 'country']),
    ...extra,
  };
}

const TRACK_KEYS: Record<string, keyof NormalizedTracking> = {
  utm_source: 'utm_source', src: 'utm_source', source: 'utm_source',
  utm_medium: 'utm_medium', medium: 'utm_medium',
  utm_campaign: 'utm_campaign', campaign: 'utm_campaign',
  utm_content: 'utm_content', content: 'utm_content',
  utm_term: 'utm_term', term: 'utm_term',
  utm_id: 'utm_id', campaign_id: 'utm_id',
  fbp: 'fbp', _fbp: 'fbp', fbc: 'fbc', _fbc: 'fbc', fbclid: 'fbclid', click_id: 'fbclid',
  external_id: 'externalId', pt_xid: 'externalId',
  purchase_event_id: 'purchaseEventId', purchaseEventId: 'purchaseEventId', meta_purchase_event_id: 'purchaseEventId',
  client_ip_address: 'clientIp', client_ip: 'clientIp', user_ip: 'clientIp',
  client_user_agent: 'userAgent', user_agent: 'userAgent',
  event_source_url: 'eventSourceUrl', page_url: 'eventSourceUrl',
};

/** Mescla fontes de rastreamento; a PRIMEIRA fonte com valor vence. */
export function trackingFrom(...sources: unknown[]): NormalizedTracking {
  const out: NormalizedTracking = {};
  for (const s of sources) {
    const o = typeof s === 'string' ? parseTrackingCode(s) : obj(s);
    for (const [k, v] of Object.entries(o)) {
      const key = TRACK_KEYS[k];
      if (!key || out[key]) continue;
      if ((typeof v === 'string' && v.trim()) || typeof v === 'number') (out as Record<string, string>)[key] = String(v).trim();
    }
  }
  return out;
}

export function product(p: Obj, currency: string, unit: AmountUnit, fallbackPrice: bigint | null = null): NormalizedProduct {
  const id = pick(p, ['product_id', 'id', 'sku', 'offer_id', 'ucode']);
  const name = pick(p, ['product_name', 'name', 'title', 'description']);
  const qty = Number(p.quantity ?? 1);
  const price = amount(pickRaw(p, ['price', 'amount', 'value']), currency, unit);
  return { id, name, quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1, priceMinor: price ?? fallbackPrice };
}

/** Timestamp em ms ou s, ou ISO → Date. */
export function toDate(v: unknown): Date | null {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
    const n = Number(v);
    if (!n) return null;
    return new Date(n > 1e12 ? n : n * 1000);
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
