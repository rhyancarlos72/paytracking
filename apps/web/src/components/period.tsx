import { CalendarDays } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Input, Select } from './ui';

export type Preset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'last_90d' | 'this_month' | 'custom';
export const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'last_90d', label: 'Últimos 90 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

/** Período guardado na URL (compartilhável e preservado ao navegar). */
export function usePeriod(defaultPreset: Preset = 'today') {
  const [sp, setSp] = useSearchParams();
  const preset = (sp.get('periodo') as Preset) || defaultPreset;
  const since = sp.get('de') ?? '';
  const until = sp.get('ate') ?? '';
  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v === null || v === '' ? n.delete(k) : n.set(k, v);
    setSp(n, { replace: true });
  };
  const valid = preset !== 'custom' || (since && until);
  return {
    preset, since, until, set,
    query: valid ? { preset, since: preset === 'custom' ? since : undefined, until: preset === 'custom' ? until : undefined } : { preset: 'today' as Preset },
    label: PRESETS.find((p) => p.value === preset)?.label ?? 'Hoje',
  };
}

export function PeriodPicker({ period }: { period: ReturnType<typeof usePeriod> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Select aria-label="Período" value={period.preset} onChange={(e) => period.set({ periodo: e.target.value })} className="w-[190px] pl-9">
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </div>
      {period.preset === 'custom' && (
        <>
          <Input type="date" aria-label="Data inicial" value={period.since} onChange={(e) => period.set({ de: e.target.value })} className="w-[150px]" />
          <Input type="date" aria-label="Data final" value={period.until} onChange={(e) => period.set({ ate: e.target.value })} className="w-[150px]" />
        </>
      )}
    </div>
  );
}
