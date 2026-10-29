/**
 * Janelas de relatório em DIAS CORRIDOS no fuso da organização, convertidas para UTC.
 * Mesma semântica de app_utc_day_window()/app_meta_day_range() do legado, mas sem
 * depender do fuso do servidor (corrige P-30).
 */

export type PeriodPreset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'last_90d' | 'this_month' | 'custom';

export interface ReportWindow {
  preset: PeriodPreset;
  timezone: string;
  /** datas locais inclusivas YYYY-MM-DD (usadas na Meta: time_range since/until) */
  since: string;
  until: string;
  startUtc: Date;
  /** exclusivo */
  endUtc: Date;
  days: number;
}

function partsInTz(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Deslocamento (ms) do fuso em um instante. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Meia-noite local de YYYY-MM-DD no fuso `tz`, em UTC. */
export function localMidnightUtc(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  let ts = guess.getTime() - tzOffsetMs(guess, tz);
  // segunda passada cobre transições de horário de verão
  ts = guess.getTime() - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function localDate(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

export function reportWindow(
  preset: PeriodPreset,
  tz: string,
  opts: { now?: Date; since?: string; until?: string } = {},
): ReportWindow {
  const today = localDate(opts.now ?? new Date(), tz);
  let since = today;
  let until = today;
  switch (preset) {
    case 'yesterday': since = until = addDays(today, -1); break;
    case 'last_7d': since = addDays(today, -6); break;
    case 'last_30d': since = addDays(today, -29); break;
    case 'last_90d': since = addDays(today, -89); break;
    case 'this_month': since = today.slice(0, 8) + '01'; break;
    case 'custom': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!opts.since || !opts.until || !re.test(opts.since) || !re.test(opts.until)) throw new Error('Período personalizado inválido');
      since = opts.since; until = opts.until;
      if (diffDays(since, until) < 0) throw new Error('Data inicial maior que a final');
      if (diffDays(since, until) > 366) throw new Error('Período máximo de 366 dias');
      break;
    }
  }
  return {
    preset, timezone: tz, since, until,
    startUtc: localMidnightUtc(since, tz),
    endUtc: localMidnightUtc(addDays(until, 1), tz),
    days: diffDays(since, until) + 1,
  };
}

/** Janela anterior de mesmo tamanho, para comparação temporal. */
export function previousWindow(w: ReportWindow): ReportWindow {
  const until = addDays(w.since, -1);
  const since = addDays(until, -(w.days - 1));
  return { ...w, preset: 'custom', since, until, startUtc: localMidnightUtc(since, w.timezone), endUtc: w.startUtc };
}

export function eachDay(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = since; diffDays(d, until) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}
