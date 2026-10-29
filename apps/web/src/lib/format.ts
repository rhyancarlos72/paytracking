/** Formatação — valores chegam do servidor em UNIDADE MÍNIMA como string (BigInt exato). */

const ZERO_DEC = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DEC = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
export const exponent = (c: string) => (ZERO_DEC.has(c) ? 0 : THREE_DEC.has(c) ? 3 : 2);

export function minorToNumber(minor: string | number | bigint | null | undefined, currency: string): number {
  if (minor === null || minor === undefined || minor === '') return 0;
  return Number(minor) / 10 ** exponent(currency);
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(currency: string, compact = false) {
  const k = `${currency}:${compact}`;
  if (!fmtCache.has(k)) {
    fmtCache.set(k, new Intl.NumberFormat('pt-BR', compact
      ? { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
      : { style: 'currency', currency, minimumFractionDigits: exponent(currency), maximumFractionDigits: exponent(currency) }));
  }
  return fmtCache.get(k)!;
}

export function money(minor: string | number | bigint | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  return nf(currency, opts.compact).format(minorToNumber(minor, currency));
}

export const int = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(n));
export const pct = (r: number | null | undefined, digits = 1) => (r === null || r === undefined || !Number.isFinite(r) ? '—' : `${(r * 100).toFixed(digits).replace('.', ',')}%`);
export const ratio = (r: number | null | undefined) => (r === null || r === undefined || !Number.isFinite(r) ? '—' : `${r.toFixed(2).replace('.', ',')}x`);

export function delta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / Math.abs(prev);
}

export function dateTime(v: string | null | undefined, tz?: string): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(v));
}

export function relative(v: string | null | undefined): string {
  if (!v) return 'nunca';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  const r = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (s < 60) return 'agora';
  if (s < 3600) return r.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return r.format(-Math.round(s / 3600), 'hour');
  return r.format(-Math.round(s / 86400), 'day');
}

export const shortDay = (ymd: string) => {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
};

export function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return u && d ? `${u[0]}•••@${d}` : e;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovado', refunded: 'Reembolsado', chargeback: 'Chargeback', canceled: 'Cancelado', failed: 'Recusado',
  sent: 'Enviado', sending: 'Enviando', dead: 'Falhou', processed: 'Processado', duplicate: 'Duplicado', ignored: 'Ignorado', rejected: 'Rejeitado',
};

export const PROVIDER_LABEL: Record<string, string> = {
  checkout: 'Checkout próprio', kiwify: 'Kiwify', cakto: 'Cakto', kirvano: 'Kirvano', hotmart: 'Hotmart', lowify: 'Lowify', wiapay: 'Wiapay',
};
