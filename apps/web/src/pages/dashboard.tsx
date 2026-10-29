import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RevenueChart } from '../components/charts';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { Badge, Callout, Card, ErrorState, Select, Skeleton } from '../components/ui';
import { get, qs } from '../lib/api';
import { delta, int, money, pct, PROVIDER_LABEL, ratio } from '../lib/format';
import { useSession } from '../lib/session';

interface Kpis {
  sales: number; revenueMinor: string; refunds: { count: number; amountMinor: string };
  pending: { count: number; amountMinor: string | null; currency: string | null };
  paymentsCreated: number; approvalRate: number | null; unconvertedSales: number; averageTicketMinor: string | null;
  meta: { connected: boolean; spendMinor?: string; purchases?: number; revenueMinor?: string; unconvertedDays?: number };
  cpaMinor: string | null; roas: number | null; profitMinor: string | null; conversionRate: number | null;
  funnel: { linkClicks: number | null; landingPageViews: number | null; pageViews: number; initiateCheckouts: number; sales: number };
  series: Array<{ day: string; sales: number; revenueMinor: string; refundsMinor: string; spendMinor: string | null }>;
}
interface Dashboard {
  reportingCurrency: string; current: Kpis; previous: Kpis;
  goals: { daily: { goalMinor: string; achievedMinor: string }; monthly: { goalMinor: string; achievedMinor: string } };
  events: { received: number; capi: Record<string, number> }; openAlerts: number;
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev);
  if (d === null || d === 0) return <span className="text-xs text-muted">{d === 0 ? 'estável' : 'sem base anterior'}</span>;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-ok' : 'text-err')}>
      {d > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
      {pct(Math.abs(d))}<span className="sr-only">{d > 0 ? 'de aumento' : 'de queda'}</span>
      <span className="ml-1 font-normal text-muted">vs. anterior</span>
    </span>
  );
}

function Stat({ label, value, sub, help, deltaEl }: { label: string; value: ReactNode; sub?: ReactNode; help?: string; deltaEl?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {label}
        {help && <span title={help} className="cursor-help"><Info className="h-3.5 w-3.5" aria-label={help} /></span>}
      </div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">{deltaEl}{sub && <span className="text-xs text-muted">{sub}</span>}</div>
    </div>
  );
}

function Goal({ label, goal, achieved, currency }: { label: string; goal: string; achieved: string; currency: string }) {
  const g = Number(goal);
  const p = g > 0 ? Math.min(1, Number(achieved) / g) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="num text-[13px] text-muted">{money(achieved, currency)} {g > 0 && <>/ {money(goal, currency)}</>}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={clsx('h-full rounded-full transition-[width] duration-700', p >= 1 ? 'bg-ok' : 'bg-primary')} style={{ width: `${p * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{g > 0 ? (p >= 1 ? 'Meta atingida' : `${pct(p, 0)} da meta`) : <Link className="text-primary hover:underline" to="/configuracoes">Definir meta</Link>}</p>
    </div>
  );
}

export default function DashboardPage() {
  const s = useSession();
  const period = usePeriod('today');
  const filters = new URLSearchParams(location.search);
  const provider = filters.get('origem') ?? '';
  const pixelId = filters.get('pixel') ?? '';
  const pixels = useQuery({ queryKey: ['pixels'], queryFn: () => get('/v1/pixels') });
  const q = useQuery<Dashboard>({
    queryKey: ['dashboard', period.query, provider, pixelId],
    queryFn: ({ signal }) => get(`/v1/reports/dashboard${qs({ ...period.query, provider, pixelId })}`, signal),
    refetchInterval: 60_000,
  });
  const cur = s.currency;

  return (
    <>
      <PageHeader title="Resumo" description={`Vendas confirmadas, investimento e retorno — valores em ${cur}, fuso ${s.org.timezone}.`}
        actions={<>
          <PeriodPicker period={period} />
          <Select aria-label="Origem" value={provider} onChange={(e) => period.set({ origem: e.target.value })} className="w-[170px]">
            <option value="">Todas as origens</option>
            {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Pixel" value={pixelId} onChange={(e) => period.set({ pixel: e.target.value })} className="w-[170px]">
            <option value="">Todos os pixels</option>
            {(pixels.data?.pixels ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </>} />

      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <DashboardSkeleton /> : (() => {
        const d = q.data;
        const c = d.current;
        const p = d.previous;
        const metaOn = c.meta.connected;
        return (
          <div className="space-y-6">
            {d.openAlerts > 0 && (
              <Callout tone="warn" title={`${d.openAlerts} alerta(s) aberto(s) na operação`} action={<Link to="/diagnostico" className="text-sm font-medium text-primary hover:underline">Ver diagnóstico</Link>}>
                Há falhas de entrega ou de configuração que podem afetar a atribuição.
              </Callout>
            )}
            {c.unconvertedSales > 0 && (
              <Callout tone="info" title={`${c.unconvertedSales} venda(s) em outra moeda sem cotação disponível`}>
                Elas aparecem na contagem, mas não somam na receita até a cotação do dia ser obtida. Nenhuma conversão é estimada.
              </Callout>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Receita confirmada" value={money(c.revenueMinor, cur)} help="Soma das vendas aprovadas no período (status atual = aprovado), convertida pela cotação do dia da aprovação."
                deltaEl={<Delta cur={Number(c.revenueMinor)} prev={Number(p.revenueMinor)} />} />
              <Stat label="Vendas confirmadas" value={int(c.sales)} help="Pagamentos aprovados pelo gateway. PIX/boleto gerado não conta."
                deltaEl={<Delta cur={c.sales} prev={p.sales} />} sub={c.averageTicketMinor ? `Ticket médio ${money(c.averageTicketMinor, cur)}` : undefined} />
              <Stat label="Investimento Meta" value={metaOn ? money(c.meta.spendMinor!, cur) : '—'}
                help="Gasto da conta de anúncios selecionada (nível conta), convertido por dia."
                deltaEl={metaOn ? <Delta cur={Number(c.meta.spendMinor)} prev={Number(p.meta.spendMinor ?? 0)} invert /> : undefined}
                sub={metaOn ? undefined : <Link to="/integracoes/meta" className="text-primary hover:underline">Conectar Meta Ads</Link>} />
              <Stat label="ROAS" value={ratio(c.roas)} help="Receita confirmada ÷ investimento."
                sub={metaOn && c.profitMinor !== null ? <span className={Number(c.profitMinor) >= 0 ? 'text-ok' : 'text-err'}>Resultado {money(c.profitMinor, cur)}</span> : undefined} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Pagamentos pendentes" value={int(c.pending.count)} help="Criados no período e ainda aguardando pagamento."
                sub={c.pending.amountMinor && c.pending.currency ? money(c.pending.amountMinor, c.pending.currency) : undefined} />
              <Stat label="Taxa de aprovação" value={pct(c.approvalRate)} help="Aprovados (incluindo depois reembolsados) ÷ pagamentos criados no período." sub={`${int(c.paymentsCreated)} pagamentos criados`} />
              <Stat label="Custo por compra" value={c.cpaMinor ? money(c.cpaMinor, cur) : '—'} help="Investimento ÷ vendas confirmadas." />
              <Stat label="Reembolsos e chargebacks" value={int(c.refunds.count)} sub={money(c.refunds.amountMinor, cur)} help="Revertidos no período; já abatidos da receita." />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
              <Card title="Evolução diária" description={`${period.label} · dados da tabela de pagamentos e da Meta`}>
                {c.series.length <= 1
                  ? <p className="py-10 text-center text-sm text-muted">Selecione um período com mais de um dia para ver a evolução.</p>
                  : <RevenueChart data={c.series} currency={cur} showSpend={metaOn} />}
              </Card>
              <Card title="Metas de faturamento" description="Hoje e mês corrente, independentemente do filtro">
                <div className="space-y-5">
                  <Goal label="Meta diária" goal={d.goals.daily.goalMinor} achieved={d.goals.daily.achievedMinor} currency={cur} />
                  <Goal label="Meta mensal" goal={d.goals.monthly.goalMinor} achieved={d.goals.monthly.achievedMinor} currency={cur} />
                </div>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card title="Funil" description="Cliques e visualizações vêm da Meta; PageView e InitiateCheckout, do pixel">
                <Funnel f={c.funnel} />
              </Card>
              <Card title="Eventos e entrega" description="Rastreamento do navegador e envio à Conversions API">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-muted">Eventos recebidos</dt><dd className="num mt-1 text-xl font-semibold">{int(d.events.received)}</dd></div>
                  <div><dt className="text-muted">Enviados à Meta</dt><dd className="num mt-1 text-xl font-semibold">{int(d.events.capi.sent ?? 0)}</dd></div>
                  <div><dt className="text-muted">Na fila</dt><dd className="num mt-1 text-xl font-semibold">{int((d.events.capi.pending ?? 0) + (d.events.capi.sending ?? 0))}</dd></div>
                  <div><dt className="text-muted">Falhas definitivas</dt><dd className="num mt-1 flex items-center gap-2 text-xl font-semibold">{int(d.events.capi.dead ?? 0)}{(d.events.capi.dead ?? 0) > 0 && <AlertTriangle className="h-4 w-4 text-err" aria-label="Há falhas" />}</dd></div>
                </dl>
                {metaOn && (
                  <div className="mt-5 rounded-xl bg-surface-2 p-4 text-sm">
                    <p className="font-medium">Atribuído pela Meta <Badge tone="neutral">referência</Badge></p>
                    <p className="mt-1 text-muted">{int(c.meta.purchases ?? 0)} compras · {money(c.meta.revenueMinor ?? '0', cur)}. Números da Meta usam a janela de atribuição dela e incluem os Purchases que o PayTracking enviou — por isso não são somados à receita confirmada.</p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        );
      })()}
    </>
  );
}

function Funnel({ f }: { f: Kpis['funnel'] }) {
  const stages = [
    { label: 'Cliques no link', n: f.linkClicks },
    { label: 'Visualizações da página (Meta)', n: f.landingPageViews },
    { label: 'PageView (pixel)', n: f.pageViews },
    { label: 'InitiateCheckout', n: f.initiateCheckouts },
    { label: 'Vendas confirmadas', n: f.sales },
  ].filter((s) => s.n !== null) as Array<{ label: string; n: number }>;
  const max = Math.max(1, ...stages.map((s) => s.n));
  return (
    <ol className="space-y-3">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]!.n : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex justify-between gap-3 text-[13px]">
              <span>{s.label}</span>
              <span className="num text-muted"><span className="font-medium text-fg">{int(s.n)}</span>{prev ? ` · ${pct(s.n / prev)} da etapa anterior` : ''}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary/80" style={{ width: `${(s.n / max) * 100}%` }} /></div>
          </li>
        );
      })}
    </ol>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card p-5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-3 h-7 w-36" /><Skeleton className="mt-3 h-3 w-24" /></div>)}</div>
      <div className="card p-5"><Skeleton className="h-[260px] w-full" /></div>
    </div>
  );
}
