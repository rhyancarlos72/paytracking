import { convertWithQuote, crossRate, localDate, type ConversionResult, type FxQuote } from '@pt/domain';
import type { Ctx } from '../context.js';

/**
 * Câmbio com a cotação DA DATA da transação (ADR-005).
 * Fonte primária: BCE via Frankfurter (base EUR). Moedas fora do BCE (ARS, CLP, COP, PEN,
 * PYG, UYU, AED…): open.er-api.com. Sem cotação → valor "não convertido" (nunca taxa 1.0).
 */

type Q = Ctx['db'];
const LOOKBACK_DAYS = 10; // fins de semana/feriados do BCE

export async function refreshRates(ctx: Ctx): Promise<{ date: string; stored: number; sources: string[] }> {
  let stored = 0;
  const sources: string[] = [];
  let date = localDate(ctx.now(), 'UTC');
  try {
    const r = await ctx.fetch('https://api.frankfurter.dev/v1/latest?base=EUR', { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const j = (await r.json()) as { date: string; rates: Record<string, number> };
      date = j.date;
      for (const [quote, rate] of Object.entries(j.rates)) stored += await storeRate(ctx.db, j.date, 'EUR', quote, rate, 'ecb-frankfurter');
      stored += await storeRate(ctx.db, j.date, 'EUR', 'EUR', 1, 'identity');
      sources.push('ecb-frankfurter');
    }
  } catch (e) {
    ctx.log.warn({ err: String(e) }, 'Frankfurter indisponível');
  }
  try {
    const r = await ctx.fetch('https://open.er-api.com/v6/latest/EUR', { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const j = (await r.json()) as { result: string; rates: Record<string, number>; time_last_update_unix: number };
      if (j.result === 'success') {
        const d = new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10);
        for (const [quote, rate] of Object.entries(j.rates)) {
          // não sobrescreve a cotação oficial do BCE do mesmo dia
          stored += await storeRate(ctx.db, d, 'EUR', quote, rate, 'open-er-api', false);
        }
        sources.push('open-er-api');
      }
    }
  } catch (e) {
    ctx.log.warn({ err: String(e) }, 'open.er-api indisponível');
  }
  return { date, stored, sources };
}

async function storeRate(db: Q, date: string, base: string, quote: string, rate: number, source: string, overwrite = true): Promise<number> {
  if (!/^[A-Z]{3}$/.test(quote) || !(rate > 0)) return 0;
  const r = await db.query(
    `INSERT INTO fx_rates(rate_date, base, quote, rate, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (rate_date, base, quote) DO ${overwrite ? 'UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = now()' : 'NOTHING'}`,
    [date, base, quote, rate.toFixed(8), source],
  );
  return r.rowCount ?? 0;
}

/** Tabela de cotações EUR→X em memória para um intervalo — evita consulta por linha. */
/** Tentativas recentes de buscar histórico (evita martelar a fonte se ela estiver fora). */
const recentHistoryFetch = new Map<string, number>();

/**
 * Garante cotações do BCE para o PERÍODO consultado. O worker só grava a cotação do dia; vendas
 * de dias anteriores (ou de quando o app ficou dormindo na hospedagem) ficavam sem cotação e
 * entravam com receita zero. Aqui, se faltar cotação para alguma moeda no início da janela,
 * busca a série histórica do período (Frankfurter/BCE) e grava antes de converter.
 */
export async function ensureFxRates(ctx: Ctx, currencies: string[], since: string, until: string): Promise<void> {
  const list = [...new Set(currencies.map((c) => String(c ?? '').trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c) && c !== 'EUR'))];
  if (!list.length) return;
  const covered = await ctx.db.query<{ quote: string }>(
    `SELECT quote FROM fx_rates WHERE base = 'EUR' AND quote = ANY($1) AND rate_date BETWEEN ($2::date - $3::int) AND $2::date GROUP BY quote`,
    [list, since, LOOKBACK_DAYS],
  );
  const have = new Set(covered.rows.map((r) => r.quote));
  const missing = list.filter((c) => !have.has(c));
  if (!missing.length) return;
  const key = `${missing.sort().join(',')}:${since}:${until}`;
  const last = recentHistoryFetch.get(key) ?? 0;
  if (Date.now() - last < 30 * 60_000) return;
  recentHistoryFetch.set(key, Date.now());
  const start = new Date(Date.parse(since) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    const r = await ctx.fetch(`https://api.frankfurter.dev/v1/${start}..${until}?base=EUR&symbols=${missing.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) { ctx.log.warn({ status: r.status, missing }, 'câmbio histórico indisponível'); return; }
    const j = (await r.json()) as { rates?: Record<string, Record<string, number>> };
    let stored = 0;
    for (const [date, rates] of Object.entries(j.rates ?? {})) {
      for (const [quote, rate] of Object.entries(rates)) stored += await storeRate(ctx.db, date, 'EUR', quote, rate, 'ecb-frankfurter', false);
    }
    ctx.log.info({ missing, since: start, until, stored }, 'câmbio histórico gravado');
  } catch (e) {
    ctx.log.warn({ err: String(e), missing }, 'câmbio histórico falhou');
  }
}

export class FxTable {
  private byQuote = new Map<string, Array<{ date: string; rate: string; source: string }>>();

  /** Carrega as cotações do período, buscando o histórico que faltar (use nos relatórios). */
  static async loadFor(ctx: Ctx, currencies: string[], since: string, until: string): Promise<FxTable> {
    await ensureFxRates(ctx, currencies, since, until);
    return FxTable.load(ctx.db, currencies, since, until);
  }

  static async load(db: Q, currencies: string[], since: string, until: string): Promise<FxTable> {
    const t = new FxTable();
    const list = [...new Set(currencies.filter((c) => c && c !== 'EUR'))];
    if (list.length) {
      const r = await db.query(
        `SELECT rate_date::text AS date, quote, rate::text AS rate, source FROM fx_rates
          WHERE base = 'EUR' AND quote = ANY($1) AND rate_date BETWEEN ($2::date - $4::int) AND $3::date
          ORDER BY quote, rate_date`,
        [list, since, until, LOOKBACK_DAYS],
      );
      for (const row of r.rows) {
        const arr = t.byQuote.get(row.quote) ?? [];
        arr.push({ date: row.date, rate: row.rate, source: row.source });
        t.byQuote.set(row.quote, arr);
      }
    }
    return t;
  }

  /** Cotação EUR→currency válida na data (última até a data, dentro da janela). */
  private eurTo(currency: string, date: string): { rate: string; date: string; source: string } | null {
    if (currency === 'EUR') return { rate: '1', date, source: 'identity' };
    const arr = this.byQuote.get(currency);
    if (!arr) return null;
    let best: { date: string; rate: string; source: string } | null = null;
    for (const r of arr) if (r.date <= date) best = r;
    if (!best) return null;
    const ageDays = (Date.parse(date) - Date.parse(best.date)) / 86_400_000;
    return ageDays <= LOOKBACK_DAYS ? best : null;
  }

  quote(from: string, to: string, date: string): FxQuote | null {
    if (from === to) return { base: from, quote: to, rate: '1', rateDate: date, source: 'identity' };
    const a = this.eurTo(from, date);
    const b = this.eurTo(to, date);
    if (!a || !b) return null;
    return { base: from, quote: to, rate: crossRate(a.rate, b.rate), rateDate: a.date > b.date ? a.date : b.date, source: `${a.source}/${b.source}` };
  }

  convert(amountMinor: bigint, from: string, to: string, date: string): ConversionResult {
    return convertWithQuote(amountMinor, from, to, this.quote(from, to, date));
  }
}
