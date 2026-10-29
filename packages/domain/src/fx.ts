import { currencyExponent } from './money.js';

/**
 * Conversão de moeda explícita e rastreável (ADR-005).
 * A taxa é "1 unidade de `from` = `rate` unidades de `to`", vinda de fx_rates
 * da DATA da transação. Nunca há fallback silencioso: sem taxa, o resultado é
 * { converted: false } e o chamador exibe o valor como "não convertido".
 */

const RATE_SCALE = 100_000_000n; // 8 casas decimais

export function parseRate(rate: string | number): bigint {
  const s = typeof rate === 'number' ? rate.toFixed(8) : rate.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Taxa de câmbio inválida: ${s}`);
  const frac = (m[2] ?? '').slice(0, 8).padEnd(8, '0');
  const scaled = BigInt(m[1] ?? '0') * RATE_SCALE + BigInt(frac);
  if (scaled <= 0n) throw new Error('Taxa de câmbio deve ser positiva');
  return scaled;
}

/** Divisão inteira com arredondamento half-up (afastando do zero). */
function divRound(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const res = r * 2n >= ad ? q + 1n : q;
  return neg ? -res : res;
}

export function convertMinor(amountMinor: bigint, from: string, to: string, rate: string | number): bigint {
  if (from === to) return amountMinor;
  const scaled = parseRate(rate);
  const expFrom = currencyExponent(from);
  const expTo = currencyExponent(to);
  const num = amountMinor * scaled * 10n ** BigInt(expTo);
  const den = RATE_SCALE * 10n ** BigInt(expFrom);
  return divRound(num, den);
}

export interface FxQuote {
  base: string;
  quote: string;
  rate: string;
  rateDate: string;
  source: string;
}

export interface ConversionResult {
  converted: boolean;
  amountMinor: bigint;
  currency: string;
  originalAmountMinor: bigint;
  originalCurrency: string;
  rate?: string;
  rateDate?: string;
}

/**
 * Taxa cruzada via moeda pivô (o BCE publica tudo contra EUR).
 * eurToFrom = quantos `from` valem 1 EUR; eurToTo = quantos `to` valem 1 EUR.
 */
export function crossRate(eurToFrom: string, eurToTo: string): string {
  const a = parseRate(eurToFrom);
  const b = parseRate(eurToTo);
  // rate(from->to) = eurToTo / eurToFrom
  const r = divRound(b * RATE_SCALE, a);
  const intPart = r / RATE_SCALE;
  const frac = (r % RATE_SCALE).toString().padStart(8, '0');
  return `${intPart}.${frac}`;
}

export function convertWithQuote(amountMinor: bigint, from: string, to: string, quote: FxQuote | null): ConversionResult {
  if (from === to) {
    return { converted: true, amountMinor, currency: to, originalAmountMinor: amountMinor, originalCurrency: from };
  }
  if (!quote) {
    return { converted: false, amountMinor, currency: from, originalAmountMinor: amountMinor, originalCurrency: from };
  }
  return {
    converted: true,
    amountMinor: convertMinor(amountMinor, from, to, quote.rate),
    currency: to,
    originalAmountMinor: amountMinor,
    originalCurrency: from,
    rate: quote.rate,
    rateDate: quote.rateDate,
  };
}
