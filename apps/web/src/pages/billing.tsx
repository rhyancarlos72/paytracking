import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, CodeBlock, ErrorState, Skeleton, STATUS_TONE } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useSession } from '../lib/session';

const PLAN_LABEL: Record<string, string> = { trial: 'Teste grátis', active: 'Ativo', expired: 'Expirado', exempt: 'Isento' };

export default function BillingPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => get('/v1/billing') });
  const pending = q.data?.charges?.find((c: any) => c.status === 'pending' && new Date(c.expires_at) > new Date());
  // aguarda a confirmação do PIX (webhook da Woovi) enquanto houver cobrança aberta
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      const r = await get('/v1/billing');
      if (r.charges.find((c: any) => c.id === pending.id)?.status === 'paid') {
        toast.ok('Pagamento confirmado', 'Sua assinatura foi renovada por 30 dias.');
        void qc.invalidateQueries();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const charge = useMutation({ mutationFn: () => post('/v1/billing/charge'), onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }), onError: (e) => toast.err(e) });

  return (
    <>
      <PageHeader title="Financeiro" description="Assinatura do PayTracking, pagamento por PIX." />
      {sp.get('expirado') && s.plan.blocked && <div className="mb-6"><Callout tone="err" title="Sua assinatura expirou">Regularize pelo PIX abaixo para voltar a acessar o painel. O rastreamento e os webhooks continuam funcionando enquanto isso.</Callout></div>}
      {q.isError ? <Card><ErrorState error={q.error} /></Card> : !q.data ? <Skeleton className="h-48" /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Card title="Plano">
            <div className="flex items-baseline gap-2"><span className="num text-3xl font-semibold">{money(q.data.plan.priceMinor, 'BRL')}</span><span className="text-muted">/ mês</span></div>
            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Status</dt><dd><Badge tone={STATUS_TONE[q.data.plan.status] ?? 'neutral'} dot>{PLAN_LABEL[q.data.plan.status]}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-muted">Válido até</dt><dd className="font-medium">{q.data.plan.status === 'exempt' ? '—' : dateTime(q.data.plan.expiresAt, s.org.timezone)}</dd></div>
              {q.data.plan.daysLeft !== null && <div className="flex justify-between"><dt className="text-muted">Dias restantes</dt><dd className="font-medium">{q.data.plan.daysLeft}</dd></div>}
            </dl>
            <p className="mt-5 text-xs text-muted">Pagamentos adicionam 30 dias a partir do vencimento atual (nunca são perdidos dias pagos antes do vencimento).</p>
          </Card>
          <Card title="Pagar com PIX">
            {!q.data.wooviConfigured ? <p className="text-sm text-muted">Pagamento indisponível no momento. Fale com o suporte.</p>
              : pending ? (
                <div className="space-y-4">
                  {pending.qr_code_image && <img src={pending.qr_code_image} alt="QR Code PIX" className="mx-auto h-52 w-52 rounded-xl border border-border bg-white p-2" />}
                  {pending.br_code && <CodeBlock label="PIX copia e cola" code={pending.br_code} />}
                  <p className="text-center text-sm text-muted">Aguardando pagamento… a confirmação é automática. Expira em {dateTime(pending.expires_at, s.org.timezone)}.</p>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <Button variant="primary" icon={<QrCode className="h-4 w-4" />} loading={charge.isPending} disabled={!s.can('owner')} onClick={() => charge.mutate()}>Gerar PIX de {money(q.data.plan.priceMinor, 'BRL')}</Button>
                  {!s.can('owner') && <p className="mt-2 text-xs text-muted">Somente o proprietário pode gerar a cobrança.</p>}
                </div>
              )}
          </Card>
          <Card title="Histórico" className="lg:col-span-2" padded={false}>
            <table className="table-base">
              <thead><tr><th>Criada</th><th>Valor</th><th>Status</th><th>Paga em</th></tr></thead>
              <tbody>{q.data.charges.map((c: any) => (
                <tr key={c.id}><td>{dateTime(c.created_at, s.org.timezone)}</td><td className="num">{money(c.amount_minor, 'BRL')}</td>
                  <td><Badge tone={c.status === 'paid' ? 'ok' : c.status === 'pending' ? 'warn' : 'neutral'}>{c.status === 'paid' ? 'Paga' : c.status === 'pending' ? 'Pendente' : 'Expirada'}</Badge></td>
                  <td>{dateTime(c.paid_at, s.org.timezone)}</td></tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
