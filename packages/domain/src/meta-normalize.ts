import { createHash } from 'node:crypto';

/**
 * Normalização + SHA-256 conforme as regras de "customer information parameters"
 * da Meta. Porta fiel de app/helpers.php (norm_*), coberta por testes de paridade.
 * fbp, fbc, client_ip_address e client_user_agent NÃO são hasheados.
 */

export const sha256 = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
const isHash = (v: string) => /^[a-f0-9]{64}$/i.test(v);

const ACCENTS: Record<string, string> = {
  á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n',
};
export const removeAccents = (s: string) => s.replace(/[áàãâäéèêëíìîïóòõôöúùûüçñ]/g, (c) => ACCENTS[c] ?? c);

type Raw = string | null | undefined;
const clean = (v: Raw): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const hashed = (v: string): string | null => (v === '' ? null : isHash(v) ? v.toLowerCase() : sha256(v));

export const normEmail = (v: Raw) => hashed(clean(v).toLowerCase());
export const normPhone = (v: Raw) => hashed(clean(v).replace(/\D+/g, ''));
export const normName = (v: Raw) => hashed(clean(v).toLowerCase());
export const normCity = (v: Raw) => hashed(removeAccents(clean(v).toLowerCase()).replace(/[^a-z]/g, ''));
export const normState = normCity;
export const normZip = (v: Raw) => hashed(clean(v).replace(/\D+/g, ''));
export const normCountry = (v: Raw) => hashed(clean(v).toLowerCase().replace(/[^a-z]/g, '').slice(0, 2));
export function normGender(v: Raw): string | null {
  const g = clean(v).toLowerCase().charAt(0);
  return g === 'f' || g === 'm' ? sha256(g) : null;
}
export function normBirthdate(v: Raw): string | null {
  const d = clean(v).replace(/\D+/g, '');
  return d.length >= 8 ? sha256(d.slice(0, 8)) : null;
}
/** Documento/CPF: só dígitos. */
export const normDocument = (v: Raw) => hashed(clean(v).replace(/\D+/g, ''));
/** external_id anônimo do navegador (pt_xid): hash do valor inteiro em minúsculas (igual ao pixel.js). */
export const normXid = (v: Raw) => hashed(clean(v).toLowerCase());

/** fbp/fbc válidos: fb.<sub>.<timestamp>.<valor>. Nunca fabricamos fbc. */
export function validFbParam(v: Raw): string | null {
  const s = clean(v);
  return /^fb\.\d\.\d+\..+$/.test(s) ? s : null;
}

/** IP público válido (sem privado/reservado/loopback). */
export function isPublicIp(ip: Raw): boolean {
  const s = clean(ip);
  if (!s) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some((o) => Number(o) > 255)) return false;
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (s.includes(':')) {
    const l = s.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return false;
    return /^[0-9a-f:]+$/.test(l);
  }
  return false;
}

/** User-agent de clientes HTTP de gateways não representa o comprador. */
export function isServerUserAgent(ua: Raw): boolean {
  const s = clean(ua);
  return /^(Hotmart-Hooks|Kiwify|GuzzleHttp|curl|axios|node-fetch|python-requests|Go-http-client|Java\/|okhttp)/i.test(s);
}
