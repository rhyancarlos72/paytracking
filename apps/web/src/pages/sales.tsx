import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Hourglass, RotateCcw, Search, ShoppingBag, Wallet, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Pager, Select, Skeleton, STATUS_TONE } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { dateTime, int, money, pct, PROVIDER_LABEL, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { mask, Name, useNamesHidden } from '../lib/privacy';

export default function SalesPage() {
  useNamesHidden(); // redesenha ao ligar/desligar o olho (selects e títulos)
  const s = useSession();
  const period = usePeriod('last_7d');
  const [sp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const provider = sp.get('origem') ?? '';
  const [search, setSearch] = useState(sp.get('busca') ?? '');
  const page = Number(sp.get('pagina') ?? 1);
  const toast = useToast();
  const qc = useQueryClient();
  const recover = useMutation({
    mutationFn: () => post<{ checked: number; recovered: number }>('/v1/payments/recover-utms'),
    onSuccess: (r) => {
      if (r.recovered > 0) toast.ok(`Campanha recuperada em ${r.recovered} venda(s)`, `${r.checked} venda(s) sem campanha verificadas.`);
      else toast.info(r.checked ? 'Nenhuma campanha encontrada para as vendas sem UTM' : 'Nenhuma venda sem campanha nos últimos 30 dias',
        r.checked ? 'Essas vendas não passaram pela página com o pixel (ex.: anúncio direto para o checkout).' : undefined);
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['top-campaigns'] });
    },
    onError: (e) => toast.err(e),
  });
  const q = useQuery({
    queryKey: ['payments', period.query, status, provider, sp.get('busca'), page],
    queryFn: ({ signal }) => get(`/v1/payments${qs({ ...period.query, status, provider, search: sp.get('busca'), page })}`, signal),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHeader title="Vendas" description="Todos os pagamentos recebidos dos gateways, com status real e envio à Meta."
        actions={<>
          <PeriodPicker period={period} />
          {s.can('admin') && (
            <Button icon={<Wand2 className="h-4 w-4" />} loading={recover.isPending} onClick={() => recover.mutate()}
              title="Relê os webhooks dos últimos 30 dias e preenche a campanha das vendas que chegaram sem UTM (ex.: Hotmart)">
              Recuperar campanhas
            </Button>
          )}
        </>} />
      <SalesHighlights query={period.query} provider={provider} currency={s.currency} onPending={() => period.set({ status: 'pending', pagina: null })} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          <form className="relative min-w-[220px] flex-1" onSubmit={(e) => { e.preventDefault(); period.set({ busca: search, pagina: null }); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Buscar transação" placeholder="Buscar por ID da transação" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </form>
          <Select aria-label="Status" value={status} onChange={(e) => period.set({ status: e.target.value, pagina: null })} className="w-[170px]">
            <option value="">Todos os status</option>
            {['approved', 'pending', 'refunded', 'chargeback', 'canceled', 'failed'].map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </Select>
          <Select aria-label="Origem" value={provider} onChange={(e) => period.set({ origem: e.target.value, pagina: null })} className="w-[190px]">
            <option value="">Todas as origens</option>
            {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : !q.data ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : q.data.payments.length === 0 ? <EmptyState title="Nenhuma venda no período" description="Assim que um gateway enviar um webhook, o pagamento aparece aqui com o status real." action={<Link to="/integracoes" className="text-sm font-medium text-primary hover:underline">Configurar integrações</Link>} />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="table-base min-w-[900px]">
                  <thead><tr><th>Transação</th><th>Status</th><th className="text-right">Valor</th><th>Origem</th><th>Pixel</th><th>Campanha (UTM)</th><th>Meta</th><th>Criado</th></tr></thead>
                  <tbody>
                    {q.data.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td><Link to={`/vendas/${p.id}`} className="font-mono text-[13px] font-medium hover:text-primary">{p.transaction_id}</Link></td>
                        <td><Badge tone={STATUS_TONE[p.status]} dot>{STATUS_LABEL[p.status] ?? p.status}</Badge></td>
                        <td className="num text-right">{p.amount_minor !== null && p.currency ? money(p.amount_minor, p.currency.trim()) : '—'}</td>
                        <td>{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                        <td className="max-w-[160px] truncate text-muted"><Name kind="pixel" value={p.pixel_name} /></td>
                        <td className="max-w-[200px] truncate text-muted" title={mask('campanha', p.utm_campaign) ?? ''}><Name kind="campanha" value={p.utm_campaign} /></td>
                        <td>{p.purchase_capi_status ? <Badge tone={STATUS_TONE[p.purchase_capi_status]}>{STATUS_LABEL[p.purchase_capi_status]}</Badge> : <span className="text-muted">—</span>}</td>
                        <td className="whitespace-nowrap text-muted">{dateTime(p.created_at, s.org.timezone)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} total={q.data.total} pageSize={q.data.pageSize} hasNext={page * q.data.pageSize < q.data.total} onPage={(n) => period.set({ pagina: String(n) })} />
            </>
          )}
      </Card>
    </>
  );
}

interface Highlights { current: { sales: number; revenueMinor: string; approvalRate: number | null; averageTicketMinor: string | null; paymentsCreated: number;
  refunds: { count: number; amountMinor: string }; pending: { count: number; amountMinor: string | null; currency: string | null } } }

/** Topo da aba: aprovado no período (azul) e pendentes (dourado) — mesmos números do Resumo. */
function SalesHighlights({ query, provider, currency, onPending }: { query: Record<string, string | undefined>; provider: string; currency: string; onPending: () => void }) {
  const q = useQuery<Highlights>({
    queryKey: ['dashboard', query, provider, ''],
    queryFn: ({ signal }) => get(`/v1/reports/dashboard${qs({ ...query, provider })}`, signal),
    refetchInterval: 60_000,
  });
  if (!q.data) return <div className="mb-6 grid gap-4 lg:grid-cols-[1.65fr_1fr]"><Skeleton className="h-[164px] rounded-[22px]" /><Skeleton className="h-[164px] rounded-[20px]" /></div>;
  const c = q.data.current;
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-[1.65fr_1fr]">
      <section className="hero-blue p-6" aria-label="Vendas aprovadas no período">
        <p className="flex items-center gap-2 text-sm font-semibold text-white/85">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20" aria-hidden><Wallet className="h-4 w-4" /></span>
          Faturamento aprovado no período
        </p>
        <p className="num mt-3 font-display text-[36px] font-extrabold leading-none tracking-[-0.03em] sm:text-[44px]">{money(c.revenueMinor, currency)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="hero-chip"><ShoppingBag className="h-3.5 w-3.5" aria-hidden />{int(c.sales)} venda{c.sales === 1 ? '' : 's'}</span>
          <span className="hero-chip">Ticket médio {c.averageTicketMinor ? money(c.averageTicketMinor, currency) : '—'}</span>
          <span className="hero-chip"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Aprovação {pct(c.approvalRate, 0)}</span>
          {c.refunds.count > 0 && <span className="hero-chip"><RotateCcw className="h-3.5 w-3.5" aria-hidden />{int(c.refunds.count)} reembolso(s) · {money(c.refunds.amountMinor, currency)}</span>}
        </div>
      </section>
      <section className="card-gold flex flex-col p-6" aria-label="Vendas pendentes">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/15 text-amber-500 ring-1 ring-inset ring-amber-400/30 dark:text-amber-300" aria-hidden><Hourglass className="h-4 w-4" /></span>
            Vendas pendentes
          </p>
          <span className="num rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-amber-950">{int(c.pending.count)}</span>
        </div>
        <p className="num mt-3 font-display text-[28px] font-bold leading-none">
          {c.pending.amountMinor && c.pending.currency ? money(c.pending.amountMinor, c.pending.currency) : c.pending.count > 0 ? `${int(c.pending.count)} em aberto` : 'Nada em aberto'}
        </p>
        <button onClick={onPending} className="mt-auto inline-flex items-center gap-1 self-end pt-4 text-sm font-semibold text-amber-600 hover:underline dark:text-amber-300">
          Ver pendentes <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </section>
    </div>
  );
}
