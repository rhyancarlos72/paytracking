/**
 * Dinheiro em unidades mínimas (BigInt) + código ISO 4217.
 *
 * Regra de ouro (ADR-005): nenhum valor financeiro passa por float. A unidade
 * de origem é sempre declarada pelo chamador ('major' = reais, 'minor' = centavos);
 * não existe heurística do tipo "inteiro >= 1000 é centavo" (bug P-04 do sistema legado).
 */

/** Expoente ISO 4217 (casas decimais). Moedas ausentes usam 2. */
const EXPONENTS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0,
  UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export type AmountUnit = 'major' | 'minor';

export interface Money {
  amountMinor: bigint;
  currency: string;
}

export function isCurrencyCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

export function normalizeCurrency(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return isCurrencyCode(c) ? c : null;
}

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

const POW10 = (n: number): bigint => 10n ** BigInt(n);

/**
 * Converte uma string decimal canônica ("1234.567", "-3", "0.5") em unidades
 * mínimas com arredondamento half-up (afastando do zero).
 */
function decimalStringToMinor(canonical: string, exponent: number): bigint | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(canonical);
  if (!m) return null;
  const negative = m[1] === '-';
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';
  const frac = fracPart.slice(0, exponent).padEnd(exponent, '0');
  let minor = BigInt(intPart) * POW10(exponent) + (frac ? BigInt(frac) : 0n);
  const nextDigit = fracPart.charAt(exponent);
  if (nextDigit !== '' && Number(nextDigit) >= 5) minor += 1n;
  return negative ? -minor : minor;
}

/**
 * Normaliza um texto monetário humano para decimal canônico.
 * Aceita "1.234,56", "1,234.56", "14,90", "R$ 197,00", "€ 49.9".
 * Regras herdadas do legado (pt_parse_money) e cobertas por testes:
 *  - com vírgula e ponto: o separador que aparece por último é o decimal;
 *  - só vírgula: decimal, exceto padrão de milhar "1,234" / "12,345,678";
 *  - só ponto: decimal, exceto múltiplos pontos ("1.234.567").
 */
export function canonicalDecimal(raw: string): string | null {
  let v = raw.trim().replace(/[^\d.,-]/g, '');
  if (v === '' || v === '-') return null;
  const neg = v.startsWith('-');
  v = v.replace(/-/g, '');
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    v = lastComma > lastDot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = (v.match(/,/g) ?? []).length;
    const after = v.length - lastComma - 1;
    const thousands = commas > 1 || (after === 3 && lastComma >= 1 && lastComma <= 3 && v[0] !== '0');
    v = thousands ? v.replace(/,/g, '') : v.replace(',', '.');
  } else if (lastDot !== -1) {
    const dots = (v.match(/\./g) ?? []).length;
    if (dots > 1) v = v.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return (neg ? '-' : '') + v;
}

/** Converte number em decimal canônico sem notação científica. */
function numberToCanonical(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  // toPrecision(15) evita ruído binário (0.1+0.2) e cobre valores monetários reais.
  let s = Number(n.toPrecision(15)).toString();
  if (/e/i.test(s)) s = n.toFixed(10).replace(/\.?0+$/, '');
  return s;
}

/**
 * Lê um valor recebido de uma integração com UNIDADE DECLARADA.
 * - unit 'minor': precisa ser inteiro (ex.: Kiwify 19700 = R$ 197,00).
 * - unit 'major': decimal (ex.: Hotmart 197.0 / "197,00").
 * Retorna null para entradas vazias/ inválidas — o chamador decide o que fazer.
 */
export function parseAmount(input: unknown, currency: string, unit: AmountUnit): bigint | null {
  if (input === null || input === undefined || input === '') return null;
  const exp = currencyExponent(currency);
  if (unit === 'minor') {
    if (typeof input === 'number') return Number.isSafeInteger(input) ? BigInt(input) : null;
    if (typeof input === 'string' && /^-?\d+$/.test(input.trim())) return BigInt(input.trim());
    if (typeof input === 'bigint') return input;
    return null;
  }
  let canonical: string | null = null;
  if (typeof input === 'number') canonical = numberToCanonical(input);
  else if (typeof input === 'string') canonical = canonicalDecimal(input);
  else if (typeof input === 'bigint') canonical = input.toString();
  return canonical === null ? null : decimalStringToMinor(canonical, exp);
}

/** "197.00" — representação decimal exata (usada no value da Meta e em relatórios). */
export function minorToDecimalString(amountMinor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = amountMinor < 0n;
  const abs = neg ? -amountMinor : amountMinor;
  const s = abs.toString().padStart(exp + 1, '0');
  const intPart = exp ? s.slice(0, -exp) : s;
  const frac = exp ? '.' + s.slice(-exp) : '';
  return (neg ? '-' : '') + intPart + frac;
}

/** Valor numérico para APIs que exigem JSON number (ex.: Meta custom_data.value). */
export function minorToNumber(amountMinor: bigint, currency: string): number {
  return Number(minorToDecimalString(amountMinor, currency));
}

export function formatMoney(amountMinor: bigint, currency: string, locale = 'pt-BR'): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minorToNumber(amountMinor, currency));
}
