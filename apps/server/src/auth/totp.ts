import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238 / RFC 4226) — o mesmo do Google Authenticator, Microsoft Authenticator, Authy,
 * 1Password: HMAC-SHA1, 6 dígitos, passo de 30 s. Aceita 1 passo de diferença de relógio e
 * nunca aceita de novo um passo já usado (anti-replay).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('segredo base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

export const counterAt = (now: Date) => Math.floor(now.getTime() / 1000 / STEP);

/** Devolve o passo aceito (para guardar e impedir reuso) ou null. */
export function verifyTotp(secret: string, code: string, now: Date, lastCounter: number | null): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = counterAt(now);
  for (const counter of [cur - 1, cur, cur + 1]) {
    if (lastCounter !== null && counter <= lastCounter) continue;
    const expected = hotp(secret, counter);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return counter;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'PayTracking'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/** Códigos de recuperação de uso único (ex.: "k7m2-p9qx"); guardamos só o sha256. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z2-7]/g, '');
