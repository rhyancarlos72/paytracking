import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useState } from 'react';
import { PeriodPicker, usePeriod } from '../components/period';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, STATUS_TONE, Tabs } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { dateTime, int, pct, PROVIDER_LABEL, relative, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';

const KEY_LABEL: Record<string, string> = {
  em: 'E-mail', ph: 'Telefone', fn: 'Nome', ln: 'Sobrenome', ct: 'Cidade', st: 'Estado', zp: 'CEP', country: 'País', ge: 'Gênero',
  db: 'Nascimento', external_id: 'External ID', fbp: 'Cookie _fbp', fbc: 'Cookie _fbc (clique)', client_ip_address: 'IP', client_user_agent: 'User-agent',
};

export default function DiagnosticsPage() {
  const [tab, setTab] = useState<'alerts' | 'capi' | 'webhooks' | 'coverage'>('alerts');
  const period = usePeriod('last_7d');
  return (
    <>
      <PageHeader title="Diagnóstico" description="Alertas, entrega à Meta, webhooks recebidos e qualidade de correspondência." actions={<PeriodPicker period={period} />} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[
        { value: 'alerts', label: 'Alertas' }, { value: 'capi', label: 'Entrega CAPI' }, { value: 'webhooks', label: 'Webhooks' }, { value: 'coverage', label: 'Cobertura' },
      ]} /></div>
      {tab === 'alerts' && <Alerts />}
      {tab === 'capi' && <Capi query={period.query} />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'coverage' && <Coverage query={period.query} />}
    </>
  );
}

function Alerts() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => get('/v1/alerts'), refetchInterval: 30_000 });
  const resolve = useMutation({ mutationFn: (id: number) => post(`/v1/alerts/${id}/resolve`), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }), onError: (e) => toast.err(e) });
  if (q.isError) return <Card><ErrorState error={q.error} /></Card>;
  if (!q.data) return <Skeleton className="h-40" />;
  const open = q.data.alerts.filter((a: any) => !a.resolved_at);
  if (!open.length) return <Card><EmptyState icon={<CheckCircle2 className="h-5 w-5 text-ok" />} title="Nenhum alerta aberto" description="Entregas, tokens e integrações estão saudáveis." /></Card>;
  const icon = { critical: <AlertOctagon className="h-5 w-5 text-err" />, warning: <AlertTriangle className="h-5 w-5 text-warn" />, info: <Info className="h-5 w-5 text-info" /> } as const;
  return (
    <div className="space-y-3">
      {open.map((a: any) => (
        <div key={a.id} className="card flex flex-wrap items-start gap-4 p-4">
          {icon[a.severity as keyof typeof icon]}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a.title} <span className="sr-only">({a.severity === 'critical' ? 'crítico' : a.severity === 'warning' ? 'atenção' : 'informativo'})</span></p>
            {a.detail && <p className="mt-0.5 text-sm text-muted">{a.detail}</p>}
            <p className="mt-1 text-xs text-subtle">{a.occurrences} ocorrência(s) · última {relative(a.last_seen_at)}</p>
          </div>
          {s.can('analyst') && <Button size="sm" onClick={() => resolve.mutate(a.id)}>Marcar como resolvido</Button>}
        </div>
      ))}
    </div>
  );
}

function Capi({ query }: { query: object }) {
  const s = useSession();
  const q = useQuery({ queryKey: ['capi-report', query], queryFn: () => get(`/v1/reports/capi${qs(query as never)}`) });
  const rec = useQuery({ queryKey: ['reconciliation', query], queryFn: () => get(`/v1/reports/reconciliation${qs(query as never)}`) });
  if (q.isError) return <Card><ErrorState error={q.error} /></Card>;
  if (!q.data) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-6">
      {rec.data && (
        <Card title="Conciliação de vendas" description="Vendas aprovadas no período × Purchase entregue à Meta">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[['Aprovadas', rec.data.approved], ['Purchase enviado', rec.data.purchase_sent], ['Na fila', rec.data.purchase_pending], ['Falhou', rec.data.purchase_dead], ['Sem pixel', rec.data.without_pixel], ['Não enfileiradas', rec.data.not_queued]].map(([l, v]) => (
              <div key={l as string}><p className="text-[13px] text-muted">{l}</p><p className="num mt-1 text-xl font-semibold">{int(v as number)}</p></div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">"Não enfileiradas" inclui vendas sem valor informado pelo gateway (a Meta exige valor no Purchase). Latência mediana até a entrega: {q.data.latencySeconds.p50 ? `${Number(q.data.latencySeconds.p50).toFixed(1)} s` : '—'} · p95: {q.data.latencySeconds.p95 ? `${Number(q.data.latencySeconds.p95).toFixed(1)} s` : '—'}</p>
        </Card>
      )}
      <Card title="Por pixel e evento" padded={false}>
        {q.data.byPixel.length === 0 ? <EmptyState title="Sem eventos no período" /> : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead><tr><th>Pixel</th><th>Evento</th><th className="text-right">Total</th><th className="text-right">Enviados</th><th className="text-right">Na fila</th><th className="text-right">Falhas</th><th className="text-right">Sucesso</th></tr></thead>
              <tbody>{q.data.byPixel.map((r: any, i: number) => (
                <tr key={i}><td>{r.pixel_name}<span className="ml-2 font-mono text-xs text-muted">{r.meta_pixel_id}</span></td><td className="font-medium">{r.event_name}</td>
                  <td className="num text-right">{int(r.total)}</td><td className="num text-right">{int(r.sent)}</td><td className="num text-right">{int(r.pending)}</td>
                  <td className="num text-right">{r.dead > 0 ? <span className="text-err">{int(r.dead)}</span> : 0}</td><td className="num text-right">{pct(r.total ? r.sent / r.total : null)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Falhas recentes" description="Mensagem devolvida pela Meta, para corrigir a causa" padded={false}>
        {q.data.failures.length === 0 ? <EmptyState title="Nenhuma falha recente" icon={<CheckCircle2 className="h-5 w-5 text-ok" />} /> : (
          <ul className="divide-y divide-border">{q.data.failures.map((f: any) => (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{f.event_name} · {f.pixel_name}</p><p className="break-words text-muted">{f.last_error}</p></div>
              <div className="flex items-center gap-2"><Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge><span className="text-xs text-muted">{dateTime(f.created_at, s.org.timezone)}</span></div>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function Webhooks() {
  const s = useSession();
  const [outcome, setOutcome] = useState('');
  const q = useQuery({ queryKey: ['receipts', outcome], queryFn: () => get(`/v1/webhook-receipts${qs({ outcome })}`), refetchInterval: 20_000 });
  return (
    <Card padded={false} title="Webhooks recebidos" description="Cada chamada dos gateways, com o resultado do processamento (sem dados pessoais)">
      <div className="px-4 pt-2"><Tabs value={outcome} onChange={setOutcome} tabs={[
        { value: '', label: 'Todos' }, { value: 'processed', label: 'Processados' }, { value: 'duplicate', label: 'Duplicados' },
        { value: 'ignored', label: 'Ignorados' }, { value: 'rejected', label: 'Rejeitados' }, { value: 'failed', label: 'Falhas' },
      ]} /></div>
      {q.isError ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="m-4 h-40" /> : q.data.receipts.length === 0 ? <EmptyState title="Nenhum webhook" /> : (
        <div className="overflow-x-auto">
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Recebido</th><th>Origem</th><th>Evento do gateway</th><th>Transação</th><th>Assinatura</th><th>Resultado</th><th>Motivo</th><th className="text-right">ms</th></tr></thead>
            <tbody>{q.data.receipts.map((r: any) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-muted">{dateTime(r.received_at, s.org.timezone)}</td>
                <td>{r.integration_name ?? PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                <td className="font-mono text-xs">{r.gateway_event ?? '—'}</td>
                <td className="font-mono text-xs">{r.transaction_id ?? '—'}</td>
                <td>{r.signature_ok === null ? '—' : r.signature_ok ? <Badge tone="ok">{r.signature_method}</Badge> : <Badge tone="err">inválida</Badge>}</td>
                <td><Badge tone={STATUS_TONE[r.outcome]}>{STATUS_LABEL[r.outcome]}</Badge></td>
                <td className="max-w-[240px] truncate text-xs text-muted" title={r.reason ?? ''}>{r.reason ?? '—'}</td>
                <td className="num text-right text-muted">{r.processing_ms ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Coverage({ query }: { query: object }) {
  const q = useQuery({ queryKey: ['coverage', query], queryFn: () => get(`/v1/reports/coverage${qs(query as never)}`) });
  if (q.isError) return <Card><ErrorState error={q.error} /></Card>;
  if (!q.data) return <Skeleton className="h-60" />;
  if (!q.data.total) return <Card><EmptyState title="Sem eventos no período" /></Card>;
  const presence = Object.entries(q.data.presence as Record<string, number>).sort((a, b) => a[1] - b[1]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card title="Presença de cada parâmetro" description={`${int(q.data.total)} eventos · quanto maior, melhor a correspondência na Meta`}>
        <ul className="space-y-3">{presence.map(([k, v]) => (
          <li key={k}>
            <div className="mb-1 flex justify-between text-[13px]"><span>{KEY_LABEL[k] ?? k}{['fbp', 'fbc', 'external_id'].includes(k) && <span className="ml-2 text-xs text-primary">chave de deduplicação</span>}</span><span className="num text-muted">{pct(v)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={v >= 0.8 ? 'h-full rounded-full bg-ok' : v >= 0.4 ? 'h-full rounded-full bg-warn' : 'h-full rounded-full bg-err'} style={{ width: `${v * 100}%` }} /></div>
          </li>
        ))}</ul>
      </Card>
      <Card title="Por tipo de evento" padded={false}>
        <table className="table-base">
          <thead><tr><th>Evento</th><th className="text-right">Total</th><th className="text-right">Parâmetros/evento</th><th className="text-right">Prontos p/ dedup</th></tr></thead>
          <tbody>{q.data.byEvent.map((r: any) => (
            <tr key={r.event_name}><td className="font-medium">{r.event_name}</td><td className="num text-right">{int(r.total)}</td><td className="num text-right">{Number(r.avg_params).toFixed(1).replace('.', ',')}</td><td className="num text-right">{pct(r.dedup_ready / r.total)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
