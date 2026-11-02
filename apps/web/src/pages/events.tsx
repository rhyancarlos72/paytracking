import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, CodeBlock, ConfirmButton, EmptyState, ErrorState, Pager, Select, Skeleton, STATUS_TONE, Tabs } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { dateTime, int, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { Name } from '../lib/privacy';

export default function EventsPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const period = usePeriod('today');
  const [sp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const eventName = sp.get('evento') ?? '';
  const page = Number(sp.get('pagina') ?? 1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['events', period.query, status, eventName, page],
    queryFn: ({ signal }) => get(`/v1/events${qs({ ...period.query, status, eventName, page })}`, signal),
    refetchInterval: 15_000,
    placeholderData: (p) => p,
  });
  const requeue = useMutation({
    mutationFn: (body: object) => post('/v1/events/requeue', body),
    onSuccess: (d: any) => { toast.ok(`${d.requeued} evento(s) recolocado(s) na fila`, 'O envio usa o mesmo event_id; a Meta não duplica.'); void qc.invalidateQueries({ queryKey: ['events'] }); },
    onError: (e) => toast.err(e),
  });
  const counts = q.data?.counts ?? {};
  return (
    <>
      <PageHeader title="Eventos" description="Tudo o que foi enfileirado para a Meta Conversions API — com resposta, tentativas e payload. Os registros ficam aqui por 3 dias (Purchase: 6 dias); depois só as contagens são guardadas, e vendas, faturamento e campanhas não mudam."
        actions={<>
          <PeriodPicker period={period} />
          {s.can('analyst') && (counts.dead ?? 0) > 0 && (
            <ConfirmButton variant="primary" icon={<RotateCcw className="h-4 w-4" />} title={`Reprocessar ${counts.dead} evento(s) com falha?`}
              description="Os eventos voltam para a fila com o mesmo event_id. Corrija a causa (ex.: token da CAPI) antes." onConfirm={() => requeue.mutateAsync({ all: true })}>
              Reprocessar falhas
            </ConfirmButton>
          )}
        </>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2">
          <Tabs value={status} onChange={(v) => period.set({ status: v, pagina: null })} tabs={[
            { value: '', label: 'Todos', count: Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0) },
            { value: 'sent', label: 'Enviados', count: counts.sent ?? 0 },
            { value: 'pending', label: 'Na fila', count: (counts.pending ?? 0) + (counts.sending ?? 0) },
            { value: 'dead', label: 'Falhas', count: counts.dead ?? 0 },
          ]} />
          <Select aria-label="Tipo de evento" value={eventName} onChange={(e) => period.set({ evento: e.target.value, pagina: null })} className="mb-2 w-[200px]">
            <option value="">Todos os eventos</option>
            {['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Lead', 'Purchase', 'Refund'].map((e) => <option key={e}>{e}</option>)}
          </Select>
        </div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : !q.data ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : q.data.events.length === 0 ? <EmptyState title="Nenhum evento" description="Instale o pixel na página de vendas ou configure uma integração para começar a receber eventos." />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="table-base min-w-[900px]">
                  <thead><tr><th className="w-8" /><th>Evento</th><th>event_id</th><th>Pixel</th><th>Status</th><th className="text-right">Tentativas</th><th>Resultado</th><th>Criado</th><th /></tr></thead>
                  <tbody>
                    {q.data.events.map((e: any) => (
                      <Fragment key={e.id}>
                        <tr>
                          <td><button aria-expanded={open === e.id} aria-label="Ver detalhes" onClick={() => setOpen(open === e.id ? null : e.id)} className="rounded p-1 text-muted hover:bg-surface-2">{open === e.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                          <td className="font-medium">{e.event_name}</td>
                          <td className="max-w-[220px] truncate font-mono text-xs text-muted" title={e.event_id}>{e.event_id}</td>
                          <td className="max-w-[160px] truncate"><Name kind="pixel" value={e.pixel_name} /></td>
                          <td><Badge tone={STATUS_TONE[e.status]} dot>{STATUS_LABEL[e.status]}</Badge></td>
                          <td className="num text-right">{int(e.attempts)}</td>
                          <td className="max-w-[280px] truncate text-xs text-muted" title={e.last_error ?? ''}>{e.status === 'sent' ? `events_received ${e.events_received}` : e.last_error ?? (e.status === 'pending' ? `próxima tentativa ${dateTime(e.next_attempt_at, s.org.timezone)}` : '—')}</td>
                          <td className="whitespace-nowrap text-muted">{dateTime(e.created_at, s.org.timezone)}</td>
                          <td>{e.status === 'dead' && s.can('analyst') && <Button size="sm" onClick={() => requeue.mutate({ id: Number(e.id) })}>Reenviar</Button>}</td>
                        </tr>
                        {open === e.id && (
                          <tr><td colSpan={9} className="bg-surface-2/40">
                            <div className="grid gap-4 py-2 lg:grid-cols-[1fr_1.4fr]">
                              <dl className="space-y-1.5 text-sm">
                                <div><dt className="inline text-muted">Correlação: </dt><dd className="inline font-mono text-xs">{e.correlation_id ?? '—'}</dd></div>
                                <div><dt className="inline text-muted">fbtrace_id: </dt><dd className="inline font-mono text-xs">{e.fbtrace_id ?? '—'}</dd></div>
                                <div><dt className="inline text-muted">HTTP: </dt><dd className="inline">{e.last_http_status ?? '—'}</dd></div>
                                <div><dt className="inline text-muted">Classe do erro: </dt><dd className="inline">{e.last_error_class ?? '—'}</dd></div>
                                <div><dt className="inline text-muted">Enviado em: </dt><dd className="inline">{dateTime(e.sent_at, s.org.timezone)}</dd></div>
                                <div><dt className="inline text-muted">Chaves de correspondência: </dt><dd className="inline">{Object.keys(e.payload?.user_data ?? {}).join(', ') || '—'}</dd></div>
                              </dl>
                              <CodeBlock label="Payload (dados pessoais hasheados)" code={JSON.stringify(e.payload, null, 2)} />
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} hasNext={q.data.events.length === q.data.pageSize} onPage={(n) => period.set({ pagina: String(n) })} />
            </>
          )}
      </Card>
    </>
  );
}
