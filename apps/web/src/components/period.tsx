import clsx from 'clsx';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';

export type Preset = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month' | 'custom';
export const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_3d', label: 'Últimos 3 dias' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'last_90d', label: 'Últimos 90 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'custom', label: 'Personalizado' },
];
const PRESET_SET = new Set(PRESETS.map((p) => p.value));

/* ---------- datas (YYYY-MM-DD, no fuso da organização) ---------- */
const todayIn = (tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const fmt = (ymd: string, year = false) => { const [y, m, d] = ymd.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1]}${year ? ` ${y}` : ''}`; };
const fmtRange = (a: string, b: string) => (a === b ? fmt(a, a.slice(0, 4) !== new Date().getFullYear().toString()) : `${fmt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmt(b, b.slice(0, 4) !== new Date().getFullYear().toString())}`);

/** Mesma regra do servidor (reportWindow), para mostrar as datas de cada atalho. */
export function presetRange(p: Preset, today: string): [string, string] {
  switch (p) {
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)];
    case 'last_3d': return [addDays(today, -2), today];
    case 'last_7d': return [addDays(today, -6), today];
    case 'last_14d': return [addDays(today, -13), today];
    case 'last_30d': return [addDays(today, -29), today];
    case 'last_90d': return [addDays(today, -89), today];
    case 'this_month': return [today.slice(0, 8) + '01', today];
    case 'last_month': { const end = addDays(today.slice(0, 8) + '01', -1); return [end.slice(0, 8) + '01', end]; }
    default: return [today, today];
  }
}

/** Período guardado na URL (compartilhável e preservado ao navegar). */
export function usePeriod(defaultPreset: Preset = 'today') {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('periodo') as Preset | null;
  const preset: Preset = raw && PRESET_SET.has(raw) ? raw : defaultPreset;
  const since = sp.get('de') ?? '';
  const until = sp.get('ate') ?? '';
  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v === null || v === '' ? n.delete(k) : n.set(k, v);
    setSp(n, { replace: true });
  };
  const valid = preset !== 'custom' || (/^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until) && since <= until);
  const effective: Preset = valid ? preset : defaultPreset;
  return {
    preset: effective, since, until, set,
    query: effective === 'custom' ? { preset: effective, since, until } : { preset: effective, since: undefined, until: undefined },
    label: effective === 'custom' ? fmtRange(since, until) : PRESETS.find((p) => p.value === effective)?.label ?? 'Hoje',
  };
}

/* ---------- calendário ---------- */
function Month({ ym, today, start, end, hover, onPick, onHover }: {
  ym: string; today: string; start: string | null; end: string | null; hover: string | null;
  onPick: (d: string) => void; onHover: (d: string | null) => void;
}) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const first = `${ym}-01`;
  const startDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // segunda = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
  const rangeEnd = end ?? (start && hover && hover >= start ? hover : null);
  return (
    <div className="w-full min-w-0 sm:w-[252px]">
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => <span key={i} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => onHover(null)}>
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const future = d > today;
          const tooOld = diffDays(d, today) > 366;
          const isStart = d === start;
          const isEnd = d === rangeEnd;
          const inRange = start && rangeEnd && d > start && d < rangeEnd;
          return (
            <button key={d} type="button" disabled={future || tooOld} onClick={() => onPick(d)} onMouseEnter={() => onHover(d)}
              aria-label={fmt(d, true)} aria-pressed={isStart || isEnd}
              className={clsx('relative h-9 text-sm transition',
                inRange && 'bg-primary/10',
                isStart && rangeEnd && rangeEnd !== start && 'rounded-l-xl bg-primary/10',
                isEnd && start && rangeEnd !== start && 'rounded-r-xl bg-primary/10',
                (future || tooOld) && 'cursor-not-allowed text-subtle/50')}>
              <span className={clsx('mx-auto flex h-9 w-9 items-center justify-center rounded-xl',
                (isStart || isEnd) ? 'bg-primary font-semibold text-white shadow-md' : !(future || tooOld) && 'hover:bg-surface-2',
                d === today && !(isStart || isEnd) && 'font-bold text-primary ring-1 ring-inset ring-primary/40')}>
                {Number(d.slice(8))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PeriodPicker({ period }: { period: ReturnType<typeof usePeriod> }) {
  const s = useSession();
  const today = todayIn(s.org.timezone);
  const [open, setOpen] = useState(false);
  const cur = period.preset === 'custom' ? [period.since, period.until] as [string, string] : presetRange(period.preset, today);
  const [draft, setDraft] = useState<{ preset: Preset; start: string | null; end: string | null }>({ preset: period.preset, start: cur[0], end: cur[1] });
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(cur[1].slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // celular: painel inferior renderizado no <body> (a animação da página usa transform, que
  // "prenderia" um position:fixed dentro do conteúdo)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft({ preset: period.preset, start: cur[0], end: cur[1] });
    setView(cur[1].slice(0, 7));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || sheetRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevYm = useMemo(() => addDays(`${view}-01`, -1).slice(0, 7), [view]);
  const nextYm = useMemo(() => addDays(`${view}-28`, 7).slice(0, 7), [view]);
  const canNext = view < today.slice(0, 7);

  const pickPreset = (p: Preset) => {
    if (p === 'custom') { setDraft({ preset: 'custom', start: null, end: null }); return; }
    period.set({ periodo: p, de: null, ate: null });
    setOpen(false);
  };
  const pickDay = (d: string) => {
    setDraft((x) => (!x.start || x.end || d < x.start ? { preset: 'custom', start: d, end: null } : { preset: 'custom', start: x.start, end: d }));
  };
  const ready = draft.start && draft.end && diffDays(draft.start, draft.end) <= 366;
  const apply = () => {
    if (!draft.start || !draft.end) return;
    period.set({ periodo: 'custom', de: draft.start, ate: draft.end });
    setOpen(false);
  };
  const panel = (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] sm:hidden" aria-hidden />
          <div ref={sheetRef} role="dialog" aria-label="Escolher período"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl border border-border bg-surface p-4 shadow-pop animate-slide-up sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-12 sm:max-h-none sm:w-auto sm:rounded-2xl sm:p-0">
            <div className="mb-3 flex items-center justify-between sm:hidden">
              <p className="font-display text-base font-bold">Período</p>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex flex-col sm:flex-row">
              {/* atalhos */}
              <ul className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3 sm:m-0 sm:w-44 sm:flex-col sm:gap-0.5 sm:overflow-visible sm:border-r sm:border-border sm:p-2">
                {PRESETS.map((p) => {
                  const active = (draft.preset === p.value) || (p.value !== 'custom' && period.preset === p.value && draft.preset !== 'custom');
                  return (
                    <li key={p.value} className="shrink-0">
                      <button type="button" onClick={() => pickPreset(p.value)}
                        className={clsx('flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm transition',
                          active ? 'bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/20 sm:ring-0' : 'bg-surface-2/70 hover:bg-surface-2 sm:bg-transparent')}>
                        {p.label}{active && <Check className="hidden h-3.5 w-3.5 sm:block" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* calendário */}
              <div className="sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" onClick={() => setView(prevYm)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
                  <div className="flex flex-1 justify-around text-sm font-semibold">
                    <span className="hidden sm:inline">{MONTHS_LONG[Number(prevYm.slice(5)) - 1]} {prevYm.slice(0, 4)}</span>
                    <span>{MONTHS_LONG[Number(view.slice(5)) - 1]} {view.slice(0, 4)}</span>
                  </div>
                  <button type="button" onClick={() => canNext && setView(nextYm)} disabled={!canNext} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
                </div>
                <div className="flex gap-6">
                  <div className="hidden sm:block"><Month ym={prevYm} today={today} start={draft.start} end={draft.end} hover={hover} onPick={pickDay} onHover={setHover} /></div>
                  <Month ym={view} today={today} start={draft.start} end={draft.end} hover={hover} onPick={pickDay} onHover={setHover} />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-sm">
                    {draft.start && draft.end ? <><span className="font-semibold">{fmtRange(draft.start, draft.end)}</span> <span className="text-muted">· {diffDays(draft.start, draft.end) + 1} dia(s)</span></>
                      : draft.start ? <span className="text-muted">Agora escolha a data final</span> : <span className="text-muted">Escolha a data inicial</span>}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2">Cancelar</button>
                    <button type="button" onClick={apply} disabled={!ready}
                      className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40">Aplicar</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
  );
  const shown = period.preset === 'custom' ? fmtRange(cur[0], cur[1]) : `${period.label} · ${fmtRange(cur[0], cur[1])}`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
        className="input flex h-10 w-auto min-w-[200px] max-w-full items-center gap-2 pr-3 text-left">
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{shown}</span>
        <ChevronDown className={clsx('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (mobile ? createPortal(panel, document.body) : panel)}
    </div>
  );
}
