import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Copy, Pause, Pencil, Play, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, EmptyState, ErrorState, Field, Input, Modal, Segmented, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { exponent, int, minorToNumber, money, pct, ratio } from '../lib/format';
import { useSession } from '../lib/session';

interface Row {
  id: string; name: string; status: string; effectiveStatus: string; campaignId?: string; campaignName?: string;
  budget: { type: 'daily' | 'lifetime'; amountMinor: string; currency: string } | null;
  spendMinor: string; cpcMinor: string; impressions: number; clicks: number; linkClicks: number; landingPageViews: number; ctr: number;
  meta: { purchases: number; revenueMinor: string }; tracked: { sales: number; revenueMinor: string; unconverted: number };
}
interface Resp { connected: boolean; accountCurrency: string; reportingCurrency: string; fx: { date: string; converted: boolean; rate: string | null }; rows: Row[] }

type Source = 'tracked' | 'meta';
type SortKey = 'name' | 'spend' | 'sales' | 'revenue' | 'roas' | 'cpa' | 'ctr';

export default function CampaignsPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const period = usePeriod('today');
  const [sp, setSp] = useSearchParams();
  const level = (sp.get('nivel') as 'campaign' | 'adset') || 'campaign';
  const campaignIds = sp.get('campanhas') ?? '';
  const [source, setSource] = useState<Source>('tracked');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'spend', dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budgetRow, setBudgetRow] = useState<Row | null>(null);

  const key = ['campaigns', period.query, level, campaignIds];
  const q = useQuery<Resp>({
    queryKey: key,
    queryFn: ({ signal }) => get(`/v1/meta/campaigns${qs({ ...period.query, level, campaignIds })}`, signal),
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body: object }) => post(`/v1/meta/entities/${id}/${path}`, body),
    onSuccess: (_d, v) => { toast.ok(v.path === 'duplicate' ? 'Cópia criada (pausada)' : 'Alteração enviada à Meta'); void qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: (e) => toast.err(e),
  });

  const cur = s.currency;
  const rows = useMemo(() => {
    const list = (q.data?.rows ?? []).map((r) => {
      const sales = source === 'tracked' ? r.tracked.sales : r.meta.purchases;
      const revenue = Number(source === 'tracked' ? r.tracked.revenueMinor : r.meta.revenueMinor);
      const spend = Number(r.spendMinor);
      return { r, sales, revenue, spend, roas: spend > 0 ? revenue / spend : null, cpa: sales > 0 ? spend / sales : null };
    });
    const val = (x: (typeof list)[number]) => ({ name: x.r.name.toLowerCase(), spend: x.spend, sales: x.sales, revenue: x.revenue, roas: x.roas ?? -1, cpa: x.cpa ?? Infinity, ctr: x.r.ctr })[sort.key];
    return list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [q.data, source, sort]);

  const tot = rows.reduce((t, x) => ({ spend: t.spend + x.spend, revenue: t.revenue + x.revenue, sales: t.sales + x.sales }), { spend: 0, revenue: 0, sales: 0 });
  const header = (k: SortKey, label: string, right = true) => (
    <th scope="col" className={right ? 'text-right' : undefined}>
      <button className="inline-flex items-center gap-1 uppercase hover:text-fg" onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? (-p.dir as 1 | -1) : -1 }))}>
        {label}{sort.key === k && (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader title="Campanhas" description="Métricas da Meta lado a lado com as vendas confirmadas e casadas por UTM."
        actions={<>
          <PeriodPicker period={period} />
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => q.refetch()} loading={q.isFetching}>Atualizar</Button>
        </>} />

      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : q.data && !q.data.connected ? (
          <Card><EmptyState title="Conecte sua conta de anúncios" description="Autorize o acesso ao Facebook Ads e selecione a conta para ver campanhas, gasto e retorno."
            action={<Link to="/integracoes/meta"><Button variant="primary">Conectar Meta Ads</Button></Link>} /></Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Nível" value={level} onChange={(v) => { const n = new URLSearchParams(sp); n.set('nivel', v); if (v === 'campaign') n.delete('campanhas'); setSp(n, { replace: true }); setSelected(new Set()); }}
                  options={[{ value: 'campaign', label: 'Campanhas' }, { value: 'adset', label: 'Conjuntos' }]} />
                {level === 'campaign' && selected.size > 0 && (
                  <Button size="sm" variant="primary" onClick={() => { const n = new URLSearchParams(sp); n.set('nivel', 'adset'); n.set('campanhas', [...selected].join(',')); setSp(n); setSelected(new Set()); }}>
                    Ver conjuntos de {selected.size} campanha(s)
                  </Button>
                )}
                {campaignIds && <Badge tone="primary">Filtrado por {campaignIds.split(',').length} campanha(s)</Badge>}
              </div>
              <div className="flex items-center gap-2 text-[13px] text-muted">
                Vendas e receita:
                <Segmented label="Fonte de vendas" value={source} onChange={setSource} options={[{ value: 'tracked', label: 'Rastreadas' }, { value: 'meta', label: 'Atribuídas pela Meta' }]} />
              </div>
            </div>

            {q.data && q.data.accountCurrency !== q.data.reportingCurrency && (
              <Callout tone={q.data.fx.converted ? 'info' : 'warn'} title={q.data.fx.converted ? `Conta em ${q.data.accountCurrency}: valores convertidos para ${cur}` : `Sem cotação ${q.data.accountCurrency}→${cur} para ${q.data.fx.date}`}>
                {q.data.fx.converted
                  ? `Cotação de ${q.data.fx.date} (1 ${q.data.accountCurrency} = ${Number(q.data.fx.rate).toFixed(4).replace('.', ',')} ${cur}). Orçamentos são exibidos e editados na moeda da conta.`
                  : 'Os valores monetários da Meta não puderam ser convertidos e foram omitidos.'}
              </Callout>
            )}

            <div className="grid gap-4 sm:grid-cols-4">
              {[
                ['Investimento', money(tot.spend, cur)],
                ['Receita', money(tot.revenue, cur)],
                ['Vendas', int(tot.sales)],
                ['ROAS', ratio(tot.spend > 0 ? tot.revenue / tot.spend : null)],
              ].map(([l, v]) => <div key={l} className="card p-4"><p className="text-[13px] text-muted">{l}</p><p className="num mt-1 text-xl font-semibold">{v}</p></div>)}
            </div>

            <div className="card overflow-hidden">
              {!q.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                : rows.length === 0 ? <EmptyState title="Nenhum resultado no período" description="Não há campanhas com dados para o filtro selecionado." />
                : (
                  <div className="overflow-x-auto">
                    <table className="table-base min-w-[1100px]">
                      <thead><tr>
                        {level === 'campaign' && <th className="w-10"><span className="sr-only">Selecionar</span></th>}
                        {header('name', level === 'campaign' ? 'Campanha' : 'Conjunto', false)}
                        <th>Orçamento</th>
                        {header('spend', 'Gasto')}{header('sales', 'Vendas')}{header('revenue', 'Receita')}{header('roas', 'ROAS')}{header('cpa', 'CPA')}
                        {header('ctr', 'CTR')}<th className="text-right">Connect</th><th className="text-right">Ações</th>
                      </tr></thead>
                      <tbody>
                        {rows.map(({ r, sales, revenue, spend, roas, cpa }) => {
                          const active = r.status === 'ACTIVE';
                          return (
                            <tr key={r.id} className={clsx(spend > 0 && sales === 0 && 'bg-warn/[0.04]')}>
                              {level === 'campaign' && (
                                <td><input type="checkbox" aria-label={`Selecionar ${r.name}`} className="h-4 w-4 accent-[rgb(var(--primary))]" checked={selected.has(r.id)}
                                  onChange={(e) => setSelected((p) => { const n = new Set(p); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></td>
                              )}
                              <td className="max-w-[360px]">
                                <div className="flex items-center gap-2">
                                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', active ? 'bg-ok' : 'bg-subtle')} aria-label={active ? 'Ativa' : 'Pausada'} />
                                  {level === 'campaign'
                                    ? <button className="truncate text-left font-medium hover:text-primary" title={r.name} onClick={() => { const n = new URLSearchParams(sp); n.set('nivel', 'adset'); n.set('campanhas', r.id); setSp(n); }}>{r.name}</button>
                                    : <span className="truncate font-medium" title={r.name}>{r.name}</span>}
                                </div>
                                {r.campaignName && <p className="ml-4 truncate text-xs text-muted">{r.campaignName}</p>}
                              </td>
                              <td className="whitespace-nowrap">
                                {r.budget ? (
                                  <button className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setBudgetRow(r)} disabled={!s.can('admin')}>
                                    <span className="num">{money(r.budget.amountMinor, r.budget.currency)}</span>
                                    <span className="text-xs text-muted">{r.budget.type === 'daily' ? '/dia' : 'total'}</span>
                                    {s.can('admin') && <Pencil className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100" aria-hidden />}
                                  </button>
                                ) : <span className="text-muted">—</span>}
                              </td>
                              <td className="num text-right">{money(spend, cur)}</td>
                              <td className="num text-right font-medium">{int(sales)}</td>
                              <td className="num text-right">{money(revenue, cur)}</td>
                              <td className={clsx('num text-right font-medium', roas !== null && (roas >= 1 ? 'text-ok' : 'text-err'))}>{ratio(roas)}</td>
                              <td className="num text-right">{cpa !== null ? money(Math.round(cpa), cur) : '—'}</td>
                              <td className="num text-right">{pct(r.ctr / 100, 2)}</td>
                              <td className="num text-right">{r.linkClicks > 0 ? pct(r.landingPageViews / r.linkClicks) : '—'}</td>
                              <td className="text-right">
                                <div className="inline-flex gap-1">
                                  <Button size="sm" variant="ghost" aria-label={active ? 'Pausar' : 'Ativar'} title={active ? 'Pausar' : 'Ativar'} disabled={!s.can('admin') || act.isPending}
                                    onClick={() => act.mutate({ id: r.id, path: 'status', body: { status: active ? 'PAUSED' : 'ACTIVE' } })}>
                                    {active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                  </Button>
                                  <Button size="sm" variant="ghost" aria-label="Duplicar" title="Duplicar (cópia pausada)" disabled={!s.can('admin') || act.isPending}
                                    onClick={() => act.mutate({ id: r.id, path: 'duplicate', body: { type: level } })}><Copy className="h-4 w-4" /></Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
            <p className="text-xs text-muted">Linhas destacadas têm gasto sem vendas {source === 'tracked' ? 'rastreadas' : 'atribuídas'}. Vendas rastreadas são casadas quando utm_campaign/content/term/medium/id contém o nome ou o ID da {level === 'campaign' ? 'campanha' : 'conjunto'}.</p>
          </div>
        )}
      <BudgetModal row={budgetRow} onClose={() => setBudgetRow(null)} onSave={(amount) => act.mutateAsync({ id: budgetRow!.id, path: 'budget', body: { type: budgetRow!.budget!.type, amount } })} />
    </>
  );
}

function BudgetModal({ row, onClose, onSave }: { row: Row | null; onClose: () => void; onSave: (amount: string) => Promise<unknown> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = row?.budget?.currency ?? 'BRL';
  const open = !!row;
  const initial = row?.budget ? minorToNumber(row.budget.amountMinor, cur).toFixed(exponent(cur)).replace('.', ',') : '';
  return (
    <Modal open={open} onClose={onClose} title="Editar orçamento" description={row?.name}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(value || initial); onClose(); } catch { /* toast já exibido */ } finally { setBusy(false); } }}>Salvar na Meta</Button>
      </>}>
      <Field label={`Orçamento ${row?.budget?.type === 'daily' ? 'diário' : 'total'} (${cur})`} htmlFor="budget"
        hint={`Valor na moeda da conta de anúncios (${cur}), sem conversão.`}>
        <Input id="budget" inputMode="decimal" key={row?.id} defaultValue={initial} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Modal>
  );
}
