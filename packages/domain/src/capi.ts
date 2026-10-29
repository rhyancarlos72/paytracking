import { VALUE_EVENTS, type MetaEventName } from './events.js';
import { minorToNumber } from './money.js';
import {
  isPublicIp, isServerUserAgent, normBirthdate, normCity, normCountry, normDocument, normEmail,
  normGender, normName, normPhone, normState, normXid, normZip, validFbParam,
} from './meta-normalize.js';

/** Dados crus do cliente — hasheados aqui, nunca persistidos em claro no outbox. */
export interface CustomerInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  document?: string | null;
  externalId?: string | null;
}

export interface TrackingInput {
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

export interface ProductInput {
  id?: string | null;
  name?: string | null;
  quantity?: number | null;
  priceMinor?: bigint | null;
}

export interface Utms {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  utm_id?: string | null;
}

export interface BuildEventInput {
  eventName: MetaEventName;
  eventId: string;
  eventTime: number;
  eventSourceUrl?: string | null;
  actionSource?: 'website' | 'system_generated' | 'other';
  customer?: CustomerInput;
  tracking?: TrackingInput;
  valueMinor?: bigint | null;
  currency?: string | null;
  products?: ProductInput[];
  contentName?: string | null;
  orderId?: string | null;
  utms?: Utms;
}

export interface MetaServerEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
}

/** Porta de MetaCapi::buildEventData com valores monetários exatos. */
export function buildServerEvent(input: BuildEventInput): MetaServerEvent {
  const c = input.customer ?? {};
  const t = input.tracking ?? {};
  const user: Record<string, unknown> = {};
  const put = (k: string, v: string | null) => {
    if (v) user[k] = [v];
  };
  put('em', normEmail(c.email));
  put('ph', normPhone(c.phone));
  put('fn', normName(c.firstName));
  put('ln', normName(c.lastName));
  put('ct', normCity(c.city));
  put('st', normState(c.state));
  put('zp', normZip(c.zip));
  put('country', normCountry(c.country));
  put('ge', normGender(c.gender));
  put('db', normBirthdate(c.birthdate));

  const ext = [normDocument(c.document), normXid(c.externalId)].filter((v): v is string => !!v);
  if (ext.length) user.external_id = [...new Set(ext)];

  const fbp = validFbParam(t.fbp);
  const fbc = validFbParam(t.fbc);
  if (fbp) user.fbp = fbp;
  if (fbc) user.fbc = fbc;
  if (isPublicIp(t.clientIp)) user.client_ip_address = String(t.clientIp).trim();
  const ua = (t.userAgent ?? '').trim();
  if (ua && !isServerUserAgent(ua)) user.client_user_agent = ua;

  const custom: Record<string, unknown> = {};
  if (VALUE_EVENTS.includes(input.eventName) && input.valueMinor != null && input.valueMinor >= 0n && input.currency) {
    custom.value = minorToNumber(input.valueMinor, input.currency);
    custom.currency = input.currency;
  }
  const products = (input.products ?? []).filter((p) => (p.id ?? p.name ?? '') !== '');
  if (products.length) {
    custom.content_ids = products.map((p) => String(p.id ?? p.name));
    custom.contents = products.map((p) => ({
      id: String(p.id ?? p.name),
      quantity: p.quantity ?? 1,
      ...(p.priceMinor != null && input.currency ? { item_price: minorToNumber(p.priceMinor, input.currency) } : {}),
    }));
    custom.content_type = 'product';
    custom.num_items = products.reduce((n, p) => n + Math.max(1, p.quantity ?? 1), 0);
    const names = [...new Set(products.map((p) => p.name).filter((n): n is string => !!n))];
    if (names.length) custom.content_name = names.join(', ');
  }
  if (input.contentName && !custom.content_name) custom.content_name = input.contentName;
  if (input.orderId) custom.order_id = input.orderId;
  for (const [k, v] of Object.entries(input.utms ?? {})) if (v) custom[k] = String(v);

  const event: MetaServerEvent = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime),
    event_id: input.eventId,
    action_source: input.actionSource ?? 'website',
    user_data: user,
    custom_data: custom,
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
  return event;
}

/** Lista das chaves de correspondência presentes (usada em diagnóstico/cobertura). */
export function matchKeys(event: MetaServerEvent): string[] {
  return Object.keys(event.user_data).sort();
}

export const MATCH_KEYS = [
  'em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'ge', 'db',
  'external_id', 'fbp', 'fbc', 'client_ip_address', 'client_user_agent',
] as const;

// ---------------------------------------------------------------------------
// Classificação da resposta da Graph API (corrige P-14/P-15)
// ---------------------------------------------------------------------------

export type DeliveryOutcome =
  | { kind: 'sent'; eventsReceived: number; fbtraceId?: string }
  | { kind: 'retryable' | 'rate_limited' | 'permanent'; message: string; code?: number; fbtraceId?: string };

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004, 80001]);
const RETRYABLE_CODES = new Set([1, 2]);
const PERMANENT_CODES = new Set([10, 100, 102, 190, 200, 270, 294, 803, 2500]);

export function classifyCapiResponse(httpStatus: number, body: unknown): DeliveryOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const err = b.error as Record<string, any> | undefined;
  const fbtraceId = (b.fbtrace_id ?? err?.fbtrace_id) as string | undefined;
  if (httpStatus >= 200 && httpStatus < 300 && !err) {
    const received = Number(b.events_received ?? 0);
    if (received >= 1) return { kind: 'sent', eventsReceived: received, fbtraceId };
    return { kind: 'retryable', message: 'Resposta 2xx sem events_received', fbtraceId };
  }
  const code = typeof err?.code === 'number' ? err.code : undefined;
  const message = String(err?.error_user_msg ?? err?.message ?? `HTTP ${httpStatus}`).slice(0, 500);
  if (httpStatus === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return { kind: 'rate_limited', message, code, fbtraceId };
  }
  if (code !== undefined && RETRYABLE_CODES.has(code)) return { kind: 'retryable', message, code, fbtraceId };
  if (err?.is_transient === true) return { kind: 'retryable', message, code, fbtraceId };
  if (httpStatus >= 500 || httpStatus === 0) return { kind: 'retryable', message, code, fbtraceId };
  if ((code !== undefined && PERMANENT_CODES.has(code)) || (httpStatus >= 400 && httpStatus < 500)) {
    return { kind: 'permanent', message, code, fbtraceId };
  }
  return { kind: 'retryable', message, code, fbtraceId };
}

/** Backoff exponencial com jitter total: base·2^n limitado a `cap`. */
export function backoffDelayMs(attempt: number, opts: { baseMs?: number; capMs?: number; random?: () => number } = {}): number {
  const base = opts.baseMs ?? 30_000;
  const cap = opts.capMs ?? 6 * 60 * 60 * 1000;
  const rnd = opts.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rnd() * (exp / 2));
}
