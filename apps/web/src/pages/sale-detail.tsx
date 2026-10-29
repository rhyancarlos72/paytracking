import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/shell';
import { Badge, Card, CodeBlock, ErrorState, Skeleton, STATUS_TONE } from '../components/ui';
import { get } from '../lib/api';
import { dateTime, money, PROVIDER_LABEL, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';

export default function SaleDetailPage() {
  const { id } = useParams();
  const s = useSession();
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => get(`/v1/payments/${id}`) });
  const tz = s.org.timezone;
  return (
    <>
      <Link to="/vendas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Vendas</Link>
      {q.isError ? <Card><ErrorState error={q.error} /></Card> : !q.data ? <Skeleton className="h-64" /> : (() => {
        const p = q.data.payment;
        return (
          <>
            <PageHeader title={`Transação ${p.transaction_id}`} description={`${PROVIDER_LABEL[p.provider] ?? p.provider} · pixel ${p.pixel_name ?? 'não associado'}`}
              actions={<Badge tone={STATUS_TONE[p.status]} dot>{STATUS_LABEL[p.status]}</Badge>} />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Pagamento" className="lg:col-span-1">
                <dl className="space-y-3 text-sm">
                  {[
                    ['Valor original', p.amount_minor !== null && p.currency ? money(p.amount_minor, p.currency.trim()) : 'não informado'],
                    ['Criado', dateTime(p.created_at, tz)],
                    ['Pendente desde', dateTime(p.pending_at, tz)],
                    ['Aprovado em', dateTime(p.approved_at, tz)],
                    ['Revertido em', dateTime(p.reversed_at, tz)],
                    ['utm_source', p.utm_source ?? '—'], ['utm_campaign', p.utm_campaign ?? '—'], ['utm_content', p.utm_content ?? '—'],
                    ['event_id do Purchase', p.purchase_event_id ?? '—'],
                  ].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="num truncate text-right font-medium">{v}</dd></div>)}
                </dl>
              </Card>
              <Card title="Linha do tempo" description="Transições de status e webhooks recebidos" className="lg:col-span-2">
                <ol className="space-y-3">
                  {q.data.transitions.map((t: any, i: number) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                      <span className="w-36 text-muted">{dateTime(t.occurred_at, tz)}</span>
                      <span>{t.from_status ? `${STATUS_LABEL[t.from_status]} → ` : ''}<strong>{STATUS_LABEL[t.to_status]}</strong></span>
                    </li>
                  ))}
                </ol>
                <h3 className="mt-6 text-sm font-semibold">Webhooks</h3>
                <ul className="mt-2 divide-y divide-border text-sm">
                  {q.data.receipts.map((r: any) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-muted">{dateTime(r.received_at, tz)} · {r.gateway_event ?? '—'}</span>
                      <span className="flex items-center gap-2"><Badge tone={STATUS_TONE[r.outcome]}>{STATUS_LABEL[r.outcome]}</Badge>{r.reason && <span className="text-xs text-muted">{r.reason}</span>}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div className="mt-6 space-y-4">
              {q.data.capi.map((o: any) => (
                <Card key={o.id} title={`${o.event_name} → Meta`} description={`event_id ${o.event_id}`} actions={<Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <p><span className="text-muted">Tentativas:</span> {o.attempts} · <span className="text-muted">events_received:</span> {o.events_received ?? '—'} · <span className="text-muted">fbtrace_id:</span> <span className="font-mono">{o.fbtrace_id ?? '—'}</span></p>
                      {o.last_error && <p className="text-err">{o.last_error}</p>}
                      <ul className="mt-2 space-y-1 text-xs text-muted">
                        {(o.attempts_log ?? []).map((a: any, i: number) => <li key={i}>{dateTime(a.at, tz)} · HTTP {a.http ?? '—'} · {a.outcome}{a.message ? ` · ${a.message}` : ''}</li>)}
                      </ul>
                    </div>
                    <CodeBlock label="Payload enviado (dados pessoais já hasheados)" code={JSON.stringify(o.payload, null, 2)} />
                  </div>
                </Card>
              ))}
            </div>
          </>
        );
      })()}
    </>
  );
}
