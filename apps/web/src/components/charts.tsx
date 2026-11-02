import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { exponent, minorToNumber, money, shortDay } from '../lib/format';

/** Lê os tokens de cor do tema atual e reage à troca claro/escuro. */
export function useChartColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    return {
      s1: s.getPropertyValue('--series-1').trim() || '#2563eb',
      s2: s.getPropertyValue('--series-2').trim() || '#0d9488',
      s3: s.getPropertyValue('--series-3').trim() || '#d97706',
      s4: s.getPropertyValue('--series-4').trim() || '#db2777',
      grid: s.getPropertyValue('--grid').trim() || '#e4e7ec',
      muted: `rgb(${s.getPropertyValue('--muted').trim().replace(/ /g, ',')})`,
      surface: `rgb(${s.getPropertyValue('--surface').trim().replace(/ /g, ',')})`,
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

export interface SeriesPoint { day: string; revenueMinor: string; spendMinor: string | null; sales: number }

/** Receita × investimento por dia — mesma unidade (moeda), um único eixo. */
export function RevenueChart({ data, currency, showSpend }: { data: SeriesPoint[]; currency: string; showSpend: boolean }) {
  const c = useChartColors();
  const rows = data.map((d) => ({
    day: d.day,
    receita: minorToNumber(d.revenueMinor, currency),
    investimento: d.spendMinor === null ? null : minorToNumber(d.spendMinor, currency),
    vendas: d.sales,
  }));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-[13px] text-muted" aria-hidden>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 rounded" style={{ background: c.s1 }} />Receita confirmada</span>
        {showSpend && <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 rounded border-t-2 border-dashed" style={{ borderColor: c.s2 }} />Investimento Meta</span>}
      </div>
      <div className="h-[260px]" role="img" aria-label="Gráfico diário de receita confirmada e investimento em anúncios">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.s1} stopOpacity={0.22} />
                <stop offset="100%" stopColor={c.s1} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 12 }} minTickGap={24} />
            <YAxis width={72} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 12 }}
              tickFormatter={(v: number) => money(Math.round(v * 10 ** exponent(currency)), currency, { compact: true })} />
            <Tooltip
              cursor={{ stroke: c.muted, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]!.payload as (typeof rows)[number];
                return (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-pop">
                    <p className="mb-1 font-medium">{shortDay(String(label))}</p>
                    <p className="flex justify-between gap-6"><span className="text-muted">Receita</span><span className="num font-medium">{money(Math.round(p.receita * 10 ** exponent(currency)), currency)}</span></p>
                    {showSpend && <p className="flex justify-between gap-6"><span className="text-muted">Investimento</span><span className="num font-medium">{p.investimento === null ? '—' : money(Math.round(p.investimento * 10 ** exponent(currency)), currency)}</span></p>}
                    <p className="flex justify-between gap-6"><span className="text-muted">Vendas</span><span className="num font-medium">{p.vendas}</span></p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="receita" name="Receita" stroke={c.s1} strokeWidth={2} fill="url(#gRev)" dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
            {showSpend && <Area type="monotone" dataKey="investimento" name="Investimento" stroke={c.s2} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} connectNulls />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Mini-gráfico de linha (tendência) — decorativo; o número principal fica sempre em texto ao lado. */
export function Sparkline({ values, height = 40, className, color = 'var(--series-1)' }: { values: number[]; height?: number; className?: string; color?: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const w = 120;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={className} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface HourPoint { hour: number; sales: number; revenueMinor: string }

/** Vendas confirmadas por hora do dia (fuso da conta). Barras finas, uma série — o título nomeia. */
export function HourlyBars({ data, currency, highlightHour }: { data: HourPoint[]; currency: string; highlightHour?: number }) {
  const c = useChartColors();
  const rows = data.map((d) => ({ ...d, label: `${String(d.hour).padStart(2, '0')}h`, receita: minorToNumber(d.revenueMinor, currency) }));
  const total = rows.reduce((n, r) => n + r.sales, 0);
  return (
    <div className="h-[240px]" role="img" aria-label={`Vendas por hora: ${total} venda(s) no período`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 11 }} interval={2} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 11 }} width={44} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-pop">
                  <p className="mb-1 font-medium">{p.label} – {String((p.hour + 1) % 24).padStart(2, '0')}h</p>
                  <p className="flex justify-between gap-6"><span className="text-muted">Vendas</span><span className="num font-medium">{p.sales}</span></p>
                  <p className="flex justify-between gap-6"><span className="text-muted">Receita</span><span className="num font-medium">{money(p.revenueMinor, currency)}</span></p>
                </div>
              );
            }}
          />
          <Bar dataKey="sales" name="Vendas" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.hour} fill={c.s1} fillOpacity={highlightHour === undefined || r.hour === highlightHour ? 1 : 0.55} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface SliceInput { key: string; label: string; sales: number; revenueMinor: string }

/** Rosca com até 4 fatias (3 maiores + "Outras"), cores fixas por posição validadas; legenda sempre visível. */
export function Donut({ items, currency, centerLabel }: { items: SliceInput[]; currency: string; centerLabel: string }) {
  const c = useChartColors();
  const colors = [c.s1, c.s2, c.s3, c.s4];
  const sorted = [...items].sort((a, b) => b.sales - a.sales);
  const slices = sorted.length > 4
    ? [...sorted.slice(0, 3), sorted.slice(3).reduce((o, x) => ({ ...o, sales: o.sales + x.sales, revenueMinor: String(BigInt(o.revenueMinor) + BigInt(x.revenueMinor)) }), { key: 'outras', label: 'Outras', sales: 0, revenueMinor: '0' })]
    : sorted;
  const total = slices.reduce((n, x) => n + x.sales, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative h-[176px] w-[176px] shrink-0" role="img" aria-label={`${centerLabel}: ${slices.map((x) => `${x.label} ${x.sales}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total ? slices : [{ key: 'vazio', label: '', sales: 1, revenueMinor: '0' }]} dataKey="sales" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={total && slices.length > 1 ? 2 : 0}
              stroke={c.surface} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {(total ? slices : [0]).map((_, i) => <Cell key={i} fill={total ? colors[i] : c.grid} />)}
            </Pie>
            {total > 0 && <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as SliceInput;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-pop">
                  <p className="mb-1 font-medium">{p.label}</p>
                  <p className="flex justify-between gap-6"><span className="text-muted">Vendas</span><span className="num font-medium">{p.sales} ({Math.round((p.sales / total) * 100)}%)</span></p>
                  <p className="flex justify-between gap-6"><span className="text-muted">Receita</span><span className="num font-medium">{money(p.revenueMinor, currency)}</span></p>
                </div>
              );
            }} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-display text-2xl font-bold">{total}</span>
          <span className="text-[11px] text-muted">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5">
        {slices.length === 0 && <li className="text-center text-sm text-muted">Sem vendas no período</li>}
        {slices.map((x, i) => (
          <li key={x.key} className="flex items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{x.label}</span>
            <span className="num text-muted">{total ? Math.round((x.sales / total) * 100) : 0}%</span>
            <span className="num w-20 text-right font-semibold">{money(x.revenueMinor, currency, { compact: true })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
