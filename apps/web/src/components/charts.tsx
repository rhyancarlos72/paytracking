import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { exponent, minorToNumber, money, shortDay } from '../lib/format';

/** Lê os tokens de cor do tema atual e reage à troca claro/escuro. */
export function useChartColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    return {
      s1: s.getPropertyValue('--series-1').trim() || '#6d4aff',
      s2: s.getPropertyValue('--series-2').trim() || '#0d9488',
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
