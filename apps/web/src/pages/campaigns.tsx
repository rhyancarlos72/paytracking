import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, CircleDollarSign, Copy, Flame, Info, Megaphone, MousePointerClick, Pause, Pencil, Play, RefreshCw, Search, ShoppingBag, Target, TrendingDown, TrendingUp, Trophy, Wallet, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, EmptyState, ErrorState, Input, Segmented, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { exponent, int, minorToNumber, money, pct, ratio } from '../lib/format';
import { alias, Name, useNamesHidden } from '../lib/privacy';
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

/** Faixa de ROAS: prejuízo (< 1), no limite (1–2), lucrativo (2–3), excelente (≥ 3). */
function roasTier(roas: number | null) {
  if (roas === null) return { label: 'sem gasto', cls: 'bg-surface-3 text-muted ring-border', bar: 'bg-subtle' };
  if (roas < 1) return { label: 'prejuízo', cls: 'bg-err/10 text-err ring-err/25', bar: 'bg-err' };
  if (roas < 2) return { label: 'no limite', cls: 'bg-warn/10 text-warn ring-warn/25', bar: 'bg-warn' };
  if (roas < 3) return { label: 'lucrativo', cls: 'bg-ok/10 text-ok ring-ok/25', bar: 'bg-ok' };
  return { label: 'excelente', cls: 'bg-ok/15 text-ok ring-ok/35', bar: 'bg-ok' };
}

function RoasPill({ roas }: { roas: number | null }) {
  const t = roasTier(roas);
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', t.cls)} title={t.label}>
      <span className="num">{ratio(roas)}</span><span className="hidden font-medium opacity-80 xl:inline">{t.label}</span>
    </span>
  );
}

export default function CampaignsPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const period = usePeriod('today');
  const [sp, setSp] = useSearchParams();
  const hideNames = useNamesHidden();
  const level = (sp.get('nivel') as 'campaign' | 'adset') || 'campaign';
  const campaignIds = sp.get('campanhas') ?? '';
  const [source, setSource] = useState<Source>('tracked');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'spend', dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'paused'>('all');
  const [onlySales, setOnlySales] = useState(false);
  const kind = level === 'campaign' ? 'campanha' : 'conjunto';

  const key = ['campaigns', period.query, level, campaignIds];
  const q = useQuery<Resp>({
    queryKey: key,
    queryFn: ({ signal }) => get(`/v1/meta/campaigns${qs({ ...period.query, level, campaignIds })}`, signal),
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body: object }) => post(`/v1/meta/entities/${id}/${path}`, body),
    onSuccess: (_d, v) => { toast.ok(v.path === 'duplicate' ? 'Cópia criada e já ativa' : v.path === 'budget' ? 'Orçamento atualizado na Meta' : 'Alteração enviada à Meta', v.path === 'duplicate' ? 'Com os conjuntos e anúncios. Ela aparece aqui em instantes.' : undefined); void qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: (e) => toast.err(e),
  });

  const cur = s.currency;
  const all = useMemo(() => (q.data?.rows ?? []).map((r) => {
    const sales = source === 'tracked' ? r.tracked.sales : r.meta.purchases;
    const revenue = Number(source === 'tracked' ? r.tracked.revenueMinor : r.meta.revenueMinor);
    const spend = Number(r.spendMinor);
    return { r, sales, revenue, spend, roas: spend > 0 ? revenue / spend : null, cpa: sales > 0 ? spend / sales : null, active: r.status === 'ACTIVE' };
  }), [q.data, source]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = all.filter((x) => (status === 'all' || (status === 'active') === x.active) && (!onlySales || x.sales > 0) && (!term || x.r.name.toLowerCase().includes(term) || (x.r.campaignName ?? '').toLowerCase().includes(term)));
    const val = (x: (typeof list)[number]) => ({ name: x.r.name.toLowerCase(), spend: x.spend, sales: x.sales, revenue: x.revenue, roas: x.roas ?? -1, cpa: x.cpa ?? Infinity, ctr: x.r.ctr })[sort.key];
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [all, sort, search, status, onlySales]);

  const tot = rows.reduce((t, x) => ({ spend: t.spend + x.spend, revenue: t.revenue + x.revenue, sales: t.sales + x.sales, clicks: t.clicks + x.r.linkClicks, lpv: t.lpv + x.r.landingPageViews }), { spend: 0, revenue: 0, sales: 0, clicks: 0, lpv: 0 });
  const totRoas = tot.spend > 0 ? tot.revenue / tot.spend : null;
  const profit = tot.revenue - tot.spend;
  const unconverted = (q.data?.rows ?? []).reduce((n, r) => n + (r.tracked.unconverted ?? 0), 0);
  const maxSpend = Math.max(1, ...rows.map((x) => x.spend));
  const counts = { active: all.filter((x) => x.active).length, paused: all.filter((x) => !x.active).length };

  // destaques do período (sobre todas as linhas, não só as filtradas)
  const withSpend = all.filter((x) => x.spend > 0);
  const best = [...withSpend].filter((x) => x.sales > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const most = [...all].filter((x) => x.sales > 0).sort((a, b) => b.sales - a.sales || b.revenue - a.revenue)[0];
  const burning = [...withSpend].filter((x) => x.sales === 0).sort((a, b) => b.spend - a.spend);

  const header = (k: SortKey, label: string, right = true) => (
    <th scope="col" className={right ? 'text-right' : undefined} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className={clsx('inline-flex items-center gap-1 uppercase transition hover:text-fg', sort.key === k && 'text-fg')} onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? (-p.dir as 1 | -1) : -1 }))}>
        {label}{sort.key === k && (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
  const drill = (id: string) => { const n = new URLSearchParams(sp); n.set('nivel', 'adset'); n.set('campanhas', id); setSp(n); };
  const busyId = act.isPending ? act.variables?.id : undefined;
  const actions = (r: Row, active: boolean) => {
    const label = hideNames ? alias(kind, r.name) : r.name;
    const can = s.can('admin') && busyId !== r.id;
    return (
      <div className="inline-flex shrink-0 gap-1">
        <button type="button" aria-label={`${active ? 'Pausar' : 'Ativar'} ${label}`} title={active ? 'Pausar' : 'Ativar'} disabled={!can}
          onClick={() => act.mutate({ id: r.id, path: 'status', body: { status: active ? 'PAUSED' : 'ACTIVE' } })}
          className={clsx('flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4',
            active ? 'bg-ok/10 text-ok ring-ok/25 hover:bg-ok/20' : 'bg-surface-2 text-muted ring-border hover:text-fg')}>
          {active ? <Pause /> : <Play />}
        </button>
        <button type="button" aria-label={`Duplicar ${label}`} title="Duplicar (a cópia já nasce ativa)" disabled={!can}
          onClick={() => act.mutate({ id: r.id, path: 'duplicate', body: { type: level } })}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4">
          <Copy />
        </button>
      </div>
    );
  };
  const budget = (r: Row) => r.budget
    ? <InlineBudget key={`${r.id}:${r.budget.amountMinor}`} budget={r.budget} editable={s.can('admin')} label={hideNames ? alias(kind, r.name) : r.name}
        onSave={(amount) => act.mutateAsync({ id: r.id, path: 'budget', body: { type: r.budget!.type, amount } })} />
    : <span className="text-muted">—</span>;

  return (
    <>
      <PageHeader title="Campanhas" eyebrow="Meta Ads" description="Gasto da Meta lado a lado com as vendas confirmadas, casadas por UTM."
        actions={<>
          <PeriodPicker period={period} />
          <Button icon={<RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()} disabled={q.isFetching}>Atualizar</Button>
        </>} />

      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : q.data && !q.data.connected ? (
          <Card><EmptyState icon={<Megaphone />} title="Conecte sua conta de anúncios" description="Autorize o acesso ao Facebook Ads e selecione a conta para ver campanhas, gasto e retorno."
            action={<Link to="/integracoes/meta"><Button variant="primary">Conectar Meta Ads</Button></Link>} /></Card>
        ) : (
          <div className="space-y-5">
            {q.data && q.data.accountCurrency !== q.data.reportingCurrency && (
              <Callout tone={q.data.fx.converted ? 'info' : 'warn'} title={q.data.fx.converted ? `Conta em ${q.data.accountCurrency}: valores convertidos para ${cur}` : `Sem cotação ${q.data.accountCurrency}→${cur} para ${q.data.fx.date}`}>
                {q.data.fx.converted
                  ? `Cotação de ${q.data.fx.date} (1 ${q.data.accountCurrency} = ${Number(q.data.fx.rate).toFixed(4).replace('.', ',')} ${cur}). Orçamentos são exibidos e editados na moeda da conta.`
                  : 'Os valores monetários da Meta não puderam ser convertidos e foram omitidos.'}
              </Callout>
            )}

            {source === 'tracked' && unconverted > 0 && (
              <Callout tone="warn" title={`${unconverted} venda(s) rastreada(s) em outra moeda ainda sem cotação`}>
                Elas contam nas vendas, mas ainda não somam na receita (nenhuma conversão é estimada). O PayTracking busca a cotação oficial do dia da venda automaticamente; atualize em alguns minutos.
              </Callout>
            )}

            {/* Resumo do período */}
            <section className="card relative overflow-hidden" aria-label="Resumo do período">
              <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/15 blur-3xl" aria-hidden />
              <div className="relative grid grid-cols-2 divide-border md:grid-cols-3 xl:grid-cols-6 xl:divide-x">
                {[
                  { l: 'Investimento', v: money(tot.spend, cur), icon: <Wallet />, sub: `${int(counts.active)} ativa(s) · ${int(counts.paused)} pausada(s)` },
                  { l: 'Receita', v: money(tot.revenue, cur), icon: <CircleDollarSign />, sub: source === 'tracked' ? 'vendas rastreadas' : 'atribuída pela Meta' },
                  { l: 'Resultado', v: money(profit, cur), icon: profit >= 0 ? <TrendingUp /> : <TrendingDown />, tone: tot.spend > 0 ? (profit >= 0 ? 'text-ok' : 'text-err') : undefined, sub: 'receita − investimento' },
                  { l: 'ROAS', v: ratio(totRoas), icon: <Target />, tone: totRoas === null ? undefined : totRoas >= 1 ? 'text-ok' : 'text-err', sub: roasTier(totRoas).label },
                  { l: 'Vendas', v: int(tot.sales), icon: <ShoppingBag />, sub: tot.sales > 0 ? `CPA ${money(Math.round(tot.spend / tot.sales), cur)}` : 'sem vendas no período' },
                  { l: 'Connect rate', v: tot.clicks > 0 ? pct(tot.lpv / tot.clicks) : '—', icon: <MousePointerClick />, sub: `${int(tot.clicks)} cliques no link` },
                ].map((k) => (
                  <div key={k.l} className="p-4 sm:p-5">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-muted"><span className="text-primary [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{k.icon}</span>{k.l}</p>
                    {!q.data ? <Skeleton className="mt-2 h-7 w-24" /> : <p className={clsx('num mt-1.5 font-display text-[22px] font-bold leading-tight tracking-tight sm:text-2xl', k.tone)}>{k.v}</p>}
                    <p className="mt-1 truncate text-xs text-muted">{k.sub}</p>
                  </div>
                ))}
              </div>
              {tot.spend > 0 && (
                <div className="relative border-t border-border px-5 py-3">
                  <div className="flex items-center justify-between text-xs text-muted"><span>Investimento × receita</span><span className="num">{totRoas !== null ? `cada ${money(10 ** exponent(cur), cur)} investido voltou ${money(Math.round(totRoas * 10 ** exponent(cur)), cur)}` : ''}</span></div>
                  <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <div className="h-full bg-primary/50" style={{ width: `${(tot.spend / Math.max(tot.spend, tot.revenue)) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <div className={clsx('h-full', profit >= 0 ? 'bg-ok' : 'bg-err')} style={{ width: `${(tot.revenue / Math.max(tot.spend, tot.revenue)) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex gap-4 text-[11px] text-muted"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/50" />Investimento</span><span className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', profit >= 0 ? 'bg-ok' : 'bg-err')} />Receita</span></div>
                </div>
              )}
            </section>

            {/* Destaques */}
            {q.data && all.length > 0 && (
              <div className="grid gap-4 md:grid-cols-3">
                <Highlight icon={<Trophy />} tone="ok" label="Melhor ROAS" empty="Nenhuma venda com gasto no período"
                  item={best && { name: best.r.name, kind, value: ratio(best.roas), detail: `${int(best.sales)} venda(s) · ${money(best.revenue, cur)}` }} />
                <Highlight icon={<ShoppingBag />} tone="primary" label="Mais vendas" empty="Sem vendas no período"
                  item={most && { name: most.r.name, kind, value: `${int(most.sales)} venda(s)`, detail: `${money(most.revenue, cur)} de receita` }} />
                <Highlight icon={<Flame />} tone="err" label="Gasto sem venda" empty="Tudo que gastou vendeu"
                  item={burning[0] && { name: burning[0].r.name, kind, value: money(burning[0].spend, cur), detail: burning.length > 1 ? `+${burning.length - 1} outra(s) sem venda` : 'nenhuma venda no período' }} />
              </div>
            )}

            {/* Barra de ferramentas */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Nível" value={level} onChange={(v) => { const n = new URLSearchParams(sp); n.set('nivel', v); if (v === 'campaign') n.delete('campanhas'); setSp(n, { replace: true }); setSelected(new Set()); }}
                  options={[{ value: 'campaign', label: 'Campanhas' }, { value: 'adset', label: 'Conjuntos' }]} />
                <Segmented label="Status" value={status} onChange={setStatus}
                  options={[{ value: 'all', label: `Todas (${all.length})` }, { value: 'active', label: `Ativas (${counts.active})` }, { value: 'paused', label: `Pausadas (${counts.paused})` }]} />
                <button type="button" onClick={() => setOnlySales((v) => !v)} aria-pressed={onlySales}
                  className={clsx('inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition',
                    onlySales ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-surface-2 text-muted hover:text-fg')}>
                  <ShoppingBag className="h-3.5 w-3.5" aria-hidden />Só com vendas
                </button>
                {/* celular: sem cabeçalho de tabela, ordenação por aqui */}
                <div className="relative md:hidden">
                  <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <select aria-label="Ordenar por" className="input h-10 w-auto cursor-pointer pl-9 pr-8"
                    value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }}>
                    <option value="sales:-1">Mais vendas</option>
                    <option value="revenue:-1">Maior receita</option>
                    <option value="roas:-1">Maior ROAS</option>
                    <option value="cpa:1">Menor CPA</option>
                    <option value="spend:-1">Maior gasto</option>
                    <option value="ctr:-1">Maior CTR</option>
                    <option value="name:1">Nome (A–Z)</option>
                  </select>
                </div>
                {campaignIds && (
                  <button className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/15"
                    onClick={() => { const n = new URLSearchParams(sp); n.delete('campanhas'); n.set('nivel', 'campaign'); setSp(n); }}>
                    Filtrado por {campaignIds.split(',').length} campanha(s) <X className="h-3.5 w-3.5" aria-label="Limpar filtro" />
                  </button>
                )}
                {level === 'campaign' && selected.size > 0 && (
                  <Button size="sm" variant="primary" onClick={() => { const n = new URLSearchParams(sp); n.set('nivel', 'adset'); n.set('campanhas', [...selected].join(',')); setSp(n); setSelected(new Set()); }}>
                    Ver conjuntos de {selected.size} campanha(s)
                  </Button>
                )}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <Input aria-label={`Buscar ${kind}`} placeholder={`Buscar ${kind}…`} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Segmented label="Fonte de vendas" value={source} onChange={setSource} options={[{ value: 'tracked', label: 'Rastreadas' }, { value: 'meta', label: 'Meta' }]} />
                <span className="cursor-help text-subtle transition hover:text-muted" tabIndex={0}
                  title={'Rastreadas: vendas aprovadas pelo gateway no período (dia da aprovação), ligadas à campanha pelas UTMs. Reembolsos saem. É o dinheiro que entrou.\n\nMeta: compras que a Meta atribui ao anúncio pelo modelo dela — janela de 7 dias após o clique e 1 dia após a visualização (inclui quem viu e não clicou), contadas no dia do clique/impressão, com estimativas para iPhone e outros aparelhos. Reembolsos não saem.\n\nPor isso os números não batem 1 a 1: use Rastreadas para o resultado real e Meta para ver o que o algoritmo está otimizando.'}>
                  <Info className="h-4 w-4" aria-label="Diferença entre vendas rastreadas e da Meta" />
                </span>
              </div>
            </div>

            {/* Lista */}
            <div className="card overflow-hidden">
              {!q.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                : rows.length === 0 ? <EmptyState icon={<Megaphone />} title={all.length ? 'Nada encontrado' : 'Nenhum resultado no período'} description={all.length ? 'Ajuste a busca ou o filtro de status.' : 'Não há campanhas com dados para o período selecionado.'} />
                : (
                  <>
                    {/* celular: cartões */}
                    <ul className="divide-y divide-border md:hidden">
                      {rows.map(({ r, sales, revenue, spend, roas, cpa, active }) => (
                        <li key={r.id} className={clsx('p-4', spend > 0 && sales === 0 && 'bg-err/[0.03]')}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 font-semibold">
                                {actions(r, active)}
                                {level === 'campaign' ? <button className="min-w-0 truncate text-left hover:text-primary" onClick={() => drill(r.id)}><Name kind={kind} value={r.name} /></button> : <Name kind={kind} value={r.name} className="min-w-0 truncate" />}
                              </p>
                              <p className="ml-[76px] truncate text-xs text-muted">
                                <span className={active ? 'text-ok' : ''}>{active ? 'Ativa' : 'Pausada'}</span>{r.campaignName && <> · <Name kind="campanha" value={r.campaignName} /></>}
                              </p>
                            </div>
                            <RoasPill roas={roas} />
                          </div>
                          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                            {[['Gasto', money(spend, cur)], ['Vendas', int(sales)], ['Receita', money(revenue, cur)]].map(([l, v]) => (
                              <div key={l} className="rounded-xl bg-surface-2/60 px-2 py-2"><dt className="text-[11px] text-muted">{l}</dt><dd className="num mt-0.5 text-sm font-semibold">{v}</dd></div>
                            ))}
                          </dl>
                          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
                            <span>CPA {cpa !== null ? money(Math.round(cpa), cur) : '—'} · CTR {pct(r.ctr / 100, 2)}</span>
                            <span className="flex items-center gap-1">{budget(r)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {/* computador: tabela */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="table-base min-w-[960px]">
                        <thead><tr>
                          {level === 'campaign' && <th className="w-10"><span className="sr-only">Selecionar</span></th>}
                          {header('name', level === 'campaign' ? 'Campanha' : 'Conjunto', false)}
                          <th>Orçamento</th>
                          {header('spend', 'Gasto')}{header('sales', 'Vendas')}{header('revenue', 'Receita')}{header('roas', 'ROAS')}{header('cpa', 'CPA')}
                          {header('ctr', 'CTR')}<th className="text-right">Connect</th>
                        </tr></thead>
                        <tbody>
                          {rows.map(({ r, sales, revenue, spend, roas, cpa, active }) => (
                            <tr key={r.id} className={clsx('group', spend > 0 && sales === 0 && 'bg-err/[0.03]')}>
                              {level === 'campaign' && (
                                <td><input type="checkbox" aria-label={`Selecionar ${hideNames ? alias(kind, r.name) : r.name}`} className="h-4 w-4 accent-[rgb(var(--primary))]" checked={selected.has(r.id)}
                                  onChange={(e) => setSelected((p) => { const n = new Set(p); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></td>
                              )}
                              <td className="max-w-[360px] 2xl:max-w-[480px]">
                                <div className="flex items-center gap-2.5">
                                  <span className={clsx('h-8 w-1 shrink-0 rounded-full', roasTier(roas).bar)} aria-hidden />
                                  {actions(r, active)}
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      {level === 'campaign'
                                        ? <button className="min-w-0 truncate text-left font-semibold transition hover:text-primary" title={hideNames ? alias(kind, r.name) : r.name} onClick={() => drill(r.id)}><Name kind={kind} value={r.name} /></button>
                                        : <span className="min-w-0 truncate font-semibold" title={hideNames ? alias(kind, r.name) : r.name}><Name kind={kind} value={r.name} /></span>}
                                    </div>
                                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                                      <span className={clsx('inline-flex items-center gap-1', active ? 'text-ok' : '')}><span className={clsx('h-1.5 w-1.5 rounded-full', active ? 'bg-ok' : 'bg-subtle')} />{active ? 'Ativa' : 'Pausada'}</span>
                                      {r.campaignName && <>· <Name kind="campanha" value={r.campaignName} /></>}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap">{budget(r)}</td>
                              <td className="text-right">
                                <p className="num">{money(spend, cur)}</p>
                                <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-surface-3" title={`${pct(tot.spend > 0 ? spend / tot.spend : 0)} do gasto`}>
                                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${(spend / maxSpend) * 100}%` }} />
                                </div>
                              </td>
                              <td className="num text-right font-semibold">{int(sales)}</td>
                              <td className="num text-right">{money(revenue, cur)}</td>
                              <td className="text-right"><RoasPill roas={roas} /></td>
                              <td className="num text-right">{cpa !== null ? money(Math.round(cpa), cur) : '—'}</td>
                              <td className="num text-right">{pct(r.ctr / 100, 2)}</td>
                              <td className="num text-right">{r.linkClicks > 0 ? pct(r.landingPageViews / r.linkClicks) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-surface-2/60 font-semibold">
                            {level === 'campaign' && <td className="border-t border-border px-4 py-3" />}
                            <td className="border-t border-border px-4 py-3">Total ({int(rows.length)})</td>
                            <td className="border-t border-border px-4 py-3" />
                            <td className="num border-t border-border px-4 py-3 text-right">{money(tot.spend, cur)}</td>
                            <td className="num border-t border-border px-4 py-3 text-right">{int(tot.sales)}</td>
                            <td className="num border-t border-border px-4 py-3 text-right">{money(tot.revenue, cur)}</td>
                            <td className="border-t border-border px-4 py-3 text-right"><RoasPill roas={totRoas} /></td>
                            <td className="num border-t border-border px-4 py-3 text-right">{tot.sales > 0 ? money(Math.round(tot.spend / tot.sales), cur) : '—'}</td>
                            <td className="border-t border-border px-4 py-3" />
                            <td className="num border-t border-border px-4 py-3 text-right">{tot.clicks > 0 ? pct(tot.lpv / tot.clicks) : '—'}</td>
                            <td className="border-t border-border px-4 py-3" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
            </div>
            <p className="text-xs text-muted">Faixa vermelha: gasto sem vendas {source === 'tracked' ? 'rastreadas' : 'atribuídas'}. Vendas rastreadas são casadas quando utm_campaign/content/term/medium/id contém o nome ou o ID da {level === 'campaign' ? 'campanha' : 'conjunto'}. ROAS: <span className="text-err">abaixo de 1 = prejuízo</span>, 1–2 no limite, 2 ou mais lucrativo.</p>
          </div>
        )}
    </>
  );
}

function Highlight({ icon, tone, label, item, empty }: {
  icon: ReactNode; tone: 'ok' | 'primary' | 'err'; label: string; empty: string;
  item: { name: string; kind: 'campanha' | 'conjunto'; value: string; detail: string } | undefined | false;
}) {
  const toneCls = { ok: 'bg-ok/10 text-ok', primary: 'bg-primary/10 text-primary', err: 'bg-err/10 text-err' }[tone];
  return (
    <div className="card card-interactive flex items-start gap-3.5 p-4">
      <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5', toneCls)} aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        {item ? (
          <>
            <p className="mt-1 truncate font-semibold"><Name kind={item.kind} value={item.name} /></p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm"><span className={clsx('num font-display text-lg font-bold', tone === 'err' ? 'text-err' : tone === 'ok' ? 'text-ok' : 'text-fg')}>{item.value}</span><span className="text-xs text-muted">{item.detail}</span></p>
          </>
        ) : <p className="mt-1 text-sm text-muted">{empty}</p>}
      </div>
    </div>
  );
}

/** Orçamento editável na própria linha: clica, digita, Enter (ou OK) salva; Esc cancela. */
function InlineBudget({ budget, editable, label, onSave }: { budget: NonNullable<Row['budget']>; editable: boolean; label: string; onSave: (amount: string) => Promise<unknown> }) {
  const cur = budget.currency;
  const initial = minorToNumber(budget.amountMinor, cur).toFixed(exponent(cur)).replace('.', ',');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [shown, setShown] = useState(budget.amountMinor); // mostra o novo valor na hora, antes da Meta recarregar
  const [busy, setBusy] = useState(false);
  const suffix = budget.type === 'daily' ? '/dia' : 'total';
  const save = async () => {
    const v = value.trim();
    if (!v || v === initial) { setEditing(false); return; }
    setBusy(true);
    try {
      const r = (await onSave(v)) as { amountMinor?: string } | undefined;
      if (r?.amountMinor) setShown(r.amountMinor);
      setEditing(false);
    } catch { /* o aviso de erro já aparece; continua editando */ } finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <button type="button" disabled={!editable} onClick={() => { setValue(initial); setEditing(true); }} title={editable ? 'Clique para alterar o orçamento' : undefined}
        aria-label={editable ? `Orçamento de ${label}: ${money(shown, cur)} ${suffix}. Clique para alterar` : undefined}
        className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ring-inset ring-transparent transition enabled:hover:bg-surface-2 enabled:hover:ring-border">
        <span className="num font-medium">{money(shown, cur)}</span>
        <span className="text-xs text-muted">{suffix}</span>
        {editable && <Pencil className="h-3 w-3 text-muted opacity-60 transition group-hover:opacity-100" aria-hidden />}
      </button>
    );
  }
  return (
    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="relative">
        <span className="sr-only">Novo orçamento {budget.type === 'daily' ? 'diário' : 'total'} de {label} ({cur})</span>
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{cur === 'BRL' ? 'R$' : cur}</span>
        <input autoFocus inputMode="decimal" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
          className="num h-8 w-[118px] rounded-lg border border-primary bg-surface pl-9 pr-2 text-right text-base font-medium outline-none ring-4 ring-primary/15 sm:text-sm" />
      </label>
      <button type="submit" disabled={busy} aria-label="Salvar orçamento" title="Salvar (Enter)"
        className="inline-flex h-8 items-center justify-center rounded-lg bg-[#2563eb] px-2.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60">
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : 'OK'}
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label="Cancelar" title="Cancelar (Esc)" className="flex h-8 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
    </form>
  );
}
