import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CheckCircle2, Clock3, Info, Megaphone, Radio, Target, TrendingUp, Trophy, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RevenueChart, Sparkline } from '../components/charts';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { Avatar, Badge, Button, Callout, Card, ErrorState, ProgressRing, Select, Skeleton, STATUS_TONE, useCountUp } from '../components/ui';
import { get, qs } from '../lib/api';
import { delta, int, minorToNumber, money, pct, PROVIDER_LABEL, ratio, relative, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { mask, Name, useNamesHidden } from '../lib/privacy';

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
interface RecentPayment { id: string; provider: string; transaction_id: string; status: string; amount_minor: string | null; currency: string | null; utm_campaign: string | null; created_at: string; approved_at: string | null }

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev);
  if (d === null || d === 0) return <span className="text-xs text-muted">{d === 0 ? 'estável vs. anterior' : 'sem base anterior'}</span>;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', good ? 'bg-ok/10 text-ok ring-ok/20' : 'bg-err/10 text-err ring-err/20')}>
      {d > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
      {pct(Math.abs(d))}<span className="sr-only">{d > 0 ? 'de aumento' : 'de queda'} em relação ao período anterior</span>
    </span>
  );
}

/** Valor em dinheiro que conta até o total (o texto final é exato). */
function AnimatedMoney({ minor, currency, className }: { minor: string; currency: string; className?: string }) {
  const v = useCountUp(Number(minor));
  return <span className={clsx('num', className)}>{money(String(Math.round(v)), currency)}</span>;
}

function Help({ text }: { text: string }) {
  return <span title={text} className="cursor-help text-subtle transition hover:text-muted"><Info className="h-3.5 w-3.5" aria-label={text} /></span>;
}

const KPI_TONE = {
  ok: { tile: 'bg-ok/10 text-ok ring-ok/20', line: 'from-ok/70' },
  warn: { tile: 'bg-warn/10 text-warn ring-warn/20', line: 'from-warn/70' },
  info: { tile: 'bg-info/10 text-info ring-info/20', line: 'from-info/70' },
  err: { tile: 'bg-err/10 text-err ring-err/20', line: 'from-err/70' },
};

function Kpi({ label, value, help, deltaEl, sub, trend, icon, tone = 'info' }: { label: string; value: ReactNode; help?: string; deltaEl?: ReactNode; sub?: ReactNode; trend?: number[]; icon: ReactNode; tone?: keyof typeof KPI_TONE }) {
  const t = KPI_TONE[tone];
  return (
    <div className="card card-interactive relative overflow-hidden p-5">
      <span className={clsx('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r to-transparent', t.line)} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">{label}{help && <Help text={help} />}</div>
        <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset [&>svg]:h-[18px] [&>svg]:w-[18px]', t.tile)} aria-hidden>{icon}</span>
      </div>
      <div className="num mt-3 font-display text-[28px] font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1">{deltaEl}{sub && <span className="text-xs text-muted">{sub}</span>}</div>
      {trend && trend.length > 1 && <Sparkline values={trend} height={36} className="-mx-5 -mb-5 mt-3 w-[calc(100%+2.5rem)]" />}
    </div>
  );
}

export default function DashboardPage() {
  useNamesHidden(); // redesenha os nomes ao ligar/desligar o olho
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
  const firstName = (s.user.name ?? '').replace(/\[.*?\]/g, '').trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader title="Resumo" eyebrow={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description={`Vendas confirmadas, investimento e retorno — valores em ${cur}, fuso ${s.org.timezone}.`}
        actions={<>
          <PeriodPicker period={period} />
          <Select aria-label="Origem" value={provider} onChange={(e) => period.set({ origem: e.target.value })} className="w-[190px]">
            <option value="">Todas as origens</option>
            {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Pixel" value={pixelId} onChange={(e) => period.set({ pixel: e.target.value })} className="w-[180px]">
            <option value="">Todos os pixels</option>
            {(pixels.data?.pixels ?? []).map((p: any) => <option key={p.id} value={p.id}>{mask('pixel', p.name)}</option>)}
          </Select>
        </>} />

      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <DashboardSkeleton /> : (() => {
        const d = q.data;
        const c = d.current;
        const p = d.previous;
        const metaOn = c.meta.connected;
        const revTrend = c.series.map((x) => minorToNumber(x.revenueMinor, cur));
        const salesTrend = c.series.map((x) => x.sales);
        return (
          <div className="space-y-6">
            {d.openAlerts > 0 && (
              <Callout tone="warn" title={`${d.openAlerts} alerta(s) aberto(s) na operação`} action={<Link to="/diagnostico" className="text-sm font-semibold text-primary hover:underline">Ver diagnóstico →</Link>}>
                Há falhas de entrega ou de configuração que podem afetar a atribuição.
              </Callout>
            )}
            {c.unconvertedSales > 0 && (
              <Callout tone="info" title={`${c.unconvertedSales} venda(s) em outra moeda sem cotação disponível`}>
                Elas aparecem na contagem, mas não somam na receita até a cotação do dia ser obtida. Nenhuma conversão é estimada.
              </Callout>
            )}

            {/* Destaque: receita + retorno */}
            <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
              <section className="card relative overflow-hidden p-6 lg:p-7" aria-labelledby="rev-title">
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" aria-hidden />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p id="rev-title" className="flex items-center gap-1.5 text-sm font-medium text-muted">
                      Receita confirmada <Help text="Soma das vendas aprovadas no período (status atual = aprovado), convertida pela cotação do dia da aprovação." />
                    </p>
                    <p className="mt-2 font-display text-[40px] font-extrabold leading-none tracking-[-0.03em] sm:text-[54px]">
                      <AnimatedMoney minor={c.revenueMinor} currency={cur} className="text-gradient" />
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <Delta cur={Number(c.revenueMinor)} prev={Number(p.revenueMinor)} />
                      <span><span className="font-semibold text-fg">{int(c.sales)}</span> venda{c.sales === 1 ? '' : 's'}</span>
                      {c.averageTicketMinor && <span>· ticket médio <span className="num font-medium text-fg">{money(c.averageTicketMinor, cur)}</span></span>}
                    </div>
                  </div>
                  <Badge tone="primary" dot>{period.label}</Badge>
                </div>
                <div className="relative mt-6">
                  {c.series.length <= 1 ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MiniStat label="Pendentes (PIX/boleto)" value={int(c.pending.count)} sub={c.pending.amountMinor && c.pending.currency ? money(c.pending.amountMinor, c.pending.currency) : 'nenhum valor em aberto'} icon={<Clock3 />} />
                      <MiniStat label="Taxa de aprovação" value={pct(c.approvalRate)} sub={`${int(c.paymentsCreated)} pagamentos criados`} icon={<CheckCircle2 />} />
                      <MiniStat label="Reembolsos" value={int(c.refunds.count)} sub={money(c.refunds.amountMinor, cur)} icon={<ArrowDownRight />} />
                    </div>
                  ) : <RevenueChart data={c.series} currency={cur} showSpend={metaOn} />}
                </div>
              </section>

              <ReturnCard c={c} p={p} cur={cur} />
            </div>

            {/* Indicadores */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Vendas confirmadas" tone="ok" value={int(c.sales)} icon={<TrendingUp />} help="Pagamentos aprovados pelo gateway. PIX/boleto gerado não conta."
                deltaEl={<Delta cur={c.sales} prev={p.sales} />} trend={salesTrend} />
              <Kpi label="Pagamentos pendentes" tone="warn" value={int(c.pending.count)} icon={<Clock3 />} help="Criados no período e ainda aguardando pagamento."
                sub={c.pending.amountMinor && c.pending.currency ? money(c.pending.amountMinor, c.pending.currency) : undefined} />
              <Kpi label="Taxa de aprovação" tone="info" value={pct(c.approvalRate)} icon={<CheckCircle2 />} help="Aprovados (incluindo depois reembolsados) ÷ pagamentos criados no período."
                sub={`${int(c.paymentsCreated)} criados`} />
              <Kpi label="Reembolsos e chargebacks" tone="err" value={int(c.refunds.count)} icon={<ArrowDownRight />} help="Revertidos no período; já abatidos da receita."
                sub={money(c.refunds.amountMinor, cur)} trend={revTrend.length > 1 ? c.series.map((x) => minorToNumber(x.refundsMinor, cur)) : undefined} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
              <TopCampaigns query={period.query} currency={cur} />
              <RecentSales />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Metas de faturamento" description="Hoje e mês corrente, independentemente do filtro" icon={<Target />}>
                <div className="grid grid-cols-2 gap-4">
                  <Goal label="Meta diária" goal={d.goals.daily.goalMinor} achieved={d.goals.daily.achievedMinor} currency={cur} />
                  <Goal label="Meta mensal" goal={d.goals.monthly.goalMinor} achieved={d.goals.monthly.achievedMinor} currency={cur} />
                </div>
              </Card>
              <Card title="Funil de conversão" description="Cliques e visualizações vêm da Meta; PageView e InitiateCheckout, do pixel" icon={<Zap />}>
                <Funnel f={c.funnel} />
              </Card>
            </div>

            <DeliveryCard d={d} c={c} cur={cur} metaOn={metaOn} />
          </div>
        );
      })()}
    </>
  );
}

function MiniStat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2/50 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-muted"><span className="text-subtle [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>{icon}</span>{label}</p>
      <p className="num mt-2 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function ReturnCard({ c, p, cur }: { c: Kpis; p: Kpis; cur: string }) {
  if (!c.meta.connected) {
    return (
      <section className="card relative flex flex-col justify-between overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-accent/10" aria-hidden />
        <div className="relative">
          <span className="icon-tile-primary h-11 w-11 [&>svg]:h-5 [&>svg]:w-5" aria-hidden><BarChart3 /></span>
          <h2 className="mt-4 text-lg font-semibold">Veja o retorno real dos anúncios</h2>
          <p className="mt-1.5 text-sm text-muted">Conecte o Meta Ads para cruzar investimento com vendas confirmadas: ROAS, custo por compra e resultado, por dia e por campanha.</p>
        </div>
        <Link to="/integracoes/meta" className="relative mt-6"><Button variant="primary" className="w-full" icon={<ArrowRight className="h-4 w-4" />}>Conectar Meta Ads</Button></Link>
      </section>
    );
  }
  const roas = c.roas ?? 0;
  const profit = c.profitMinor !== null ? Number(c.profitMinor) : null;
  return (
    <section className="card p-6" aria-labelledby="ret-title">
      <h2 id="ret-title" className="flex items-center gap-1.5 text-sm font-medium text-muted">Retorno sobre investimento <Help text="ROAS = receita confirmada ÷ investimento. O anel completa em 3x." /></h2>
      <div className="mt-4 flex items-center gap-6">
        <ProgressRing value={roas / 3} size={120} stroke={10} label={`ROAS ${ratio(c.roas)}`} done={roas >= 1}>
          <span className="num text-2xl font-semibold">{ratio(c.roas)}</span>
          <span className="text-[11px] text-muted">ROAS</span>
        </ProgressRing>
        <dl className="min-w-0 flex-1 space-y-3 text-sm">
          <div><dt className="text-muted">Investimento Meta</dt><dd className="num text-lg font-semibold">{money(c.meta.spendMinor!, cur)}</dd>
            <Delta cur={Number(c.meta.spendMinor)} prev={Number(p.meta.spendMinor ?? 0)} invert /></div>
          <div><dt className="text-muted">Custo por compra</dt><dd className="num font-semibold">{c.cpaMinor ? money(c.cpaMinor, cur) : '—'}</dd></div>
        </dl>
      </div>
      {profit !== null && (
        <div className={clsx('mt-5 flex items-center justify-between rounded-2xl px-4 py-3 text-sm ring-1 ring-inset', profit >= 0 ? 'bg-ok/10 ring-ok/20' : 'bg-err/10 ring-err/20')}>
          <span className="text-muted">Resultado (receita − investimento)</span>
          <span className={clsx('num font-semibold', profit >= 0 ? 'text-ok' : 'text-err')}>{money(c.profitMinor!, cur)}</span>
        </div>
      )}
    </section>
  );
}

function Goal({ label, goal, achieved, currency }: { label: string; goal: string; achieved: string; currency: string }) {
  const g = Number(goal);
  const p = g > 0 ? Number(achieved) / g : 0;
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border bg-surface-2/40 p-4 text-center">
      <ProgressRing value={p} size={96} stroke={9} label={label} done={g > 0 && p >= 1}>
        <span className="num text-lg font-semibold">{g > 0 ? pct(Math.min(p, 9.99), 0) : '—'}</span>
      </ProgressRing>
      <p className="mt-3 text-[13px] font-semibold">{label}</p>
      <p className="num mt-0.5 text-xs text-muted">{money(achieved, currency)}{g > 0 && <> de {money(goal, currency)}</>}</p>
      {g <= 0 ? <Link className="mt-1 text-xs font-semibold text-primary hover:underline" to="/configuracoes">Definir meta</Link>
        : p >= 1 ? <p className="mt-1 text-xs font-semibold text-ok">Meta atingida 🎉</p> : null}
    </div>
  );
}

function Funnel({ f }: { f: Kpis['funnel'] }) {
  const stages = [
    { label: 'Cliques no link', n: f.linkClicks },
    { label: 'Visualizações (Meta)', n: f.landingPageViews },
    { label: 'PageView (pixel)', n: f.pageViews },
    { label: 'InitiateCheckout', n: f.initiateCheckouts },
    { label: 'Vendas confirmadas', n: f.sales },
  ].filter((s) => s.n !== null) as Array<{ label: string; n: number }>;
  const max = Math.max(1, ...stages.map((s) => s.n));
  return (
    <ol className="space-y-3.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]!.n : null;
        const last = i === stages.length - 1;
        return (
          <li key={s.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
              <span className={clsx(last && 'font-semibold')}>{s.label}</span>
              <span className="num text-muted"><span className="font-semibold text-fg">{int(s.n)}</span>{prev ? <span className="ml-1.5 text-xs">{pct(s.n / prev)}</span> : null}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
              <div className={clsx('h-full rounded-full transition-[width] duration-700', last ? 'bg-gradient-to-r from-[#8b70ff] to-[#5b37f0]' : 'bg-primary/45')}
                style={{ width: `${Math.max(2, (s.n / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RecentSales({ className }: { className?: string }) {
  const q = useQuery<{ payments: RecentPayment[] }>({
    queryKey: ['recent-sales'],
    queryFn: ({ signal }) => get(`/v1/payments${qs({ preset: 'last_30d', page: 1 })}`, signal),
    refetchInterval: 15_000,
  });
  const items = (q.data?.payments ?? []).slice(0, 6);
  return (
    <Card className={className} title={<span className="flex items-center gap-2">Últimas vendas <span className="live-dot" aria-hidden /></span>}
      description="Atualiza sozinho a cada 15 s" icon={<Radio />} padded={false}
      actions={<Link to="/vendas" className="text-xs font-semibold text-primary hover:underline">Ver todas →</Link>}>
      {!q.data ? <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : items.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">Nenhum pagamento nos últimos 30 dias.</p>
        : (
          <ul className="divide-y divide-border/70">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={`/vendas/${p.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-2/60">
                  <Avatar name={PROVIDER_LABEL[p.provider] ?? p.provider} className="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium"><Name kind="campanha" value={p.utm_campaign} fallback={PROVIDER_LABEL[p.provider] ?? p.provider} /></p>
                    <p className="truncate text-xs text-muted">{PROVIDER_LABEL[p.provider] ?? p.provider} · {relative(p.approved_at ?? p.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm font-semibold">{p.amount_minor && p.currency ? money(p.amount_minor, p.currency) : '—'}</p>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

interface AttrRow { source: string; key: string; pageViews: number; initiateCheckouts: number; sales: number; revenueMinor: string }

/** Ranking das campanhas (utm_campaign) por receita confirmada no período. */
function TopCampaigns({ query, currency }: { query: Record<string, string | undefined>; currency: string }) {
  useNamesHidden();
  const q = useQuery<{ rows: AttrRow[] }>({
    queryKey: ['top-campaigns', query],
    queryFn: ({ signal }) => get(`/v1/reports/attribution${qs({ ...query, dimension: 'utm_campaign' })}`, signal),
    refetchInterval: 60_000,
  });
  const byKey = new Map<string, { key: string; sales: number; revenue: number; pageViews: number }>();
  for (const r of q.data?.rows ?? []) {
    if (r.key === '—') continue;
    const x = byKey.get(r.key) ?? { key: r.key, sales: 0, revenue: 0, pageViews: 0 };
    x.sales += r.sales; x.revenue += Number(r.revenueMinor); x.pageViews += r.pageViews;
    byKey.set(r.key, x);
  }
  const list = [...byKey.values()].filter((x) => x.sales > 0).sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
  const top = list.slice(0, 5);
  const totalRev = list.reduce((t, x) => t + x.revenue, 0);
  const max = Math.max(1, ...top.map((x) => x.revenue));
  const medal = ['bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950', 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800', 'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950'];
  return (
    <Card title="Campanhas que mais venderam" description="Receita confirmada por utm_campaign no período" icon={<Trophy />}
      actions={<Link to="/campanhas" className="text-xs font-semibold text-primary hover:underline">Campanhas →</Link>}>
      {!q.data ? <div className="space-y-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : top.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="icon-tile h-11 w-11 [&>svg]:h-5 [&>svg]:w-5" aria-hidden><Megaphone /></span>
            <p className="mt-3 text-sm font-semibold">Nenhuma venda com campanha no período</p>
            <p className="mt-1 max-w-sm text-xs text-muted">Use <code className="font-mono">utm_campaign={'{{campaign.name}}'}</code> nos links dos anúncios para ver o ranking aqui.</p>
          </div>
        ) : (
          <ol className="space-y-4">
            {top.map((x, i) => (
              <li key={x.key} className="flex items-center gap-3">
                <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold', medal[i] ?? 'bg-surface-3 text-muted')}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold"><Name kind="campanha" value={x.key} /></p>
                    <p className="num shrink-0 text-sm font-bold">{money(String(x.revenue), currency)}</p>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#8b70ff] to-[#c084fc] transition-[width] duration-700" style={{ width: `${Math.max(3, (x.revenue / max) * 100)}%` }} />
                  </div>
                  <p className="mt-1 flex justify-between text-[11px] text-muted">
                    <span>{int(x.sales)} venda{x.sales === 1 ? '' : 's'}{x.pageViews > 0 && <> · conversão {pct(x.sales / x.pageViews)}</>}</span>
                    <span className="num">{pct(totalRev > 0 ? x.revenue / totalRev : 0)} da receita</span>
                  </p>
                </div>
              </li>
            ))}
            {list.length > top.length && <li className="text-xs text-muted">+{list.length - top.length} outra(s) campanha(s) com vendas</li>}
          </ol>
        )}
    </Card>
  );
}

function DeliveryCard({ d, c, cur, metaOn }: { d: Dashboard; c: Kpis; cur: string; metaOn: boolean }) {
  const sent = d.events.capi.sent ?? 0;
  const queued = (d.events.capi.pending ?? 0) + (d.events.capi.sending ?? 0);
  const dead = d.events.capi.dead ?? 0;
  const total = Math.max(1, sent + queued + dead);
  const seg = [
    { label: 'Enviados', n: sent, cls: 'bg-ok' },
    { label: 'Na fila', n: queued, cls: 'bg-warn' },
    { label: 'Falhas', n: dead, cls: 'bg-err' },
  ];
  return (
    <Card title="Eventos e entrega à Meta" description="Rastreamento do navegador e envio pela Conversions API" icon={<Zap />}
      actions={<Link to="/diagnostico" className="text-xs font-semibold text-primary hover:underline">Diagnóstico →</Link>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted">Eventos recebidos</dt><dd className="num mt-1 text-2xl font-semibold">{int(d.events.received)}</dd></div>
          <div><dt className="text-muted">Enviados à Meta</dt><dd className="num mt-1 text-2xl font-semibold">{int(sent)}</dd></div>
          <div><dt className="text-muted">Na fila</dt><dd className="num mt-1 text-2xl font-semibold">{int(queued)}</dd></div>
          <div><dt className="text-muted">Falhas definitivas</dt><dd className="num mt-1 flex items-center gap-2 text-2xl font-semibold">{int(dead)}{dead > 0 && <AlertTriangle className="h-4 w-4 text-err" aria-label="Há falhas" />}</dd></div>
        </dl>
        <div>
          <p className="text-[13px] font-medium">Situação dos envios no período</p>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            {sent + queued + dead > 0 && seg.map((x) => x.n > 0 && <div key={x.label} className={clsx('h-full first:rounded-l-full last:rounded-r-full', x.cls)} style={{ width: `${(x.n / total) * 100}%` }} />)}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            {seg.map((x) => <li key={x.label} className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', x.cls)} aria-hidden />{x.label}: <span className="num font-semibold text-fg">{int(x.n)}</span></li>)}
          </ul>
          {metaOn && (
            <div className="mt-4 rounded-2xl bg-surface-2/60 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">Atribuído pela Meta <Badge tone="neutral">referência</Badge></p>
              <p className="mt-1 text-muted">{int(c.meta.purchases ?? 0)} compras · {money(c.meta.revenueMinor ?? '0', cur)}. A Meta usa a própria janela de atribuição e inclui os Purchases que o PayTracking enviou — por isso não soma à receita confirmada.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <div className="card p-7"><Skeleton className="h-4 w-36" /><Skeleton className="mt-4 h-12 w-64" /><Skeleton className="mt-4 h-4 w-48" /><Skeleton className="mt-8 h-40 w-full" /></div>
        <div className="card p-6"><Skeleton className="h-4 w-40" /><Skeleton className="mx-auto mt-6 h-28 w-28 rounded-full" /><Skeleton className="mt-6 h-10 w-full" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card p-5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-4 h-7 w-24" /><Skeleton className="mt-3 h-3 w-20" /></div>)}</div>
    </div>
  );
}
