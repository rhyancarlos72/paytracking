import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { Card, EmptyState, ErrorState, Segmented, Skeleton } from '../components/ui';
import { get, qs } from '../lib/api';
import { int, money, pct } from '../lib/format';
import { useSession } from '../lib/session';
import { mask, Name, useNamesHidden, UTM_KIND } from '../lib/privacy';

type Dim = 'utm_campaign' | 'utm_source' | 'utm_medium' | 'utm_content' | 'utm_term';

export default function AttributionPage() {
  useNamesHidden(); // redesenha ao ligar/desligar o olho (selects e títulos)
  const s = useSession();
  const period = usePeriod('last_7d');
  const [sp] = useSearchParams();
  const dimension = (sp.get('dimensao') as Dim) || 'utm_campaign';
  const q = useQuery({ queryKey: ['attribution', period.query, dimension], queryFn: ({ signal }) => get(`/v1/reports/attribution${qs({ ...period.query, dimension })}`, signal) });
  const rows = q.data?.rows ?? [];
  const tot = rows.reduce((t: any, r: any) => ({ pv: t.pv + r.pageViews, ic: t.ic + r.initiateCheckouts, s: t.s + r.sales, rev: t.rev + Number(r.revenueMinor) }), { pv: 0, ic: 0, s: 0, rev: 0 });
  return (
    <>
      <PageHeader title="Atribuição" description="Funil do navegador e vendas confirmadas agrupados por UTM. Moedas convertidas pela cotação do dia da venda." actions={<PeriodPicker period={period} />} />
      <div className="mb-4">
        <Segmented label="Agrupar por" value={dimension} onChange={(v) => period.set({ dimensao: v })} options={[
          { value: 'utm_campaign', label: 'Campanha' }, { value: 'utm_content', label: 'Conteúdo' }, { value: 'utm_term', label: 'Termo' },
          { value: 'utm_medium', label: 'Mídia' }, { value: 'utm_source', label: 'Origem' },
        ]} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[['PageView', int(tot.pv)], ['InitiateCheckout', int(tot.ic)], ['Vendas', int(tot.s)], ['Receita', money(tot.rev, s.currency)]].map(([l, v]) => (
          <div key={l} className="card p-4"><p className="text-[13px] text-muted">{l}</p><p className="num mt-1 text-xl font-semibold">{v}</p></div>
        ))}
      </div>
      <Card padded={false}>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : !q.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : rows.length === 0 ? <EmptyState title="Sem dados de UTM no período" description="Use parâmetros utm_* nos links dos anúncios (ex.: utm_campaign={{campaign.name}}|{{campaign.id}})." />
          : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[760px]">
                <thead><tr><th>Origem</th><th>{dimension.replace('utm_', '')}</th><th className="text-right">PageView</th><th className="text-right">IC</th><th className="text-right">Vendas</th><th className="text-right">Conv. PV→venda</th><th className="text-right">Receita</th></tr></thead>
                <tbody>
                  {rows.map((r: any, i: number) => (
                    <tr key={i}>
                      <td className="font-medium">{r.source}</td>
                      <td className="max-w-[320px] truncate" title={UTM_KIND[dimension] ? (mask(UTM_KIND[dimension]!, r.key) ?? '') : r.key}>{UTM_KIND[dimension] ? <Name kind={UTM_KIND[dimension]!} value={r.key} /> : r.key}</td>
                      <td className="num text-right">{int(r.pageViews)}</td>
                      <td className="num text-right">{int(r.initiateCheckouts)}</td>
                      <td className="num text-right font-medium">{int(r.sales)}</td>
                      <td className="num text-right">{r.pageViews ? pct(r.sales / r.pageViews) : '—'}</td>
                      <td className="num text-right">{money(r.revenueMinor, s.currency)}{r.unconverted > 0 && <span className="ml-1 text-xs text-warn" title="Vendas sem cotação">+{r.unconverted}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  );
}
