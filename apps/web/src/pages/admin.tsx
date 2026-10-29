import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton, STATUS_TONE } from '../components/ui';
import { del, get, post, qs } from '../lib/api';
import { dateTime, int, money } from '../lib/format';
import { useSession } from '../lib/session';

export default function AdminPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => get('/v1/admin/overview'), enabled: s.user.isPlatformAdmin });
  const orgs = useQuery({ queryKey: ['admin-orgs', search, status], queryFn: () => get(`/v1/admin/orgs${qs({ q: search, status })}`), enabled: s.user.isPlatformAdmin });
  const act = useMutation({
    mutationFn: ({ id, action, days }: { id: string; action: string; days?: number }) => post(`/v1/admin/orgs/${id}/plan`, { action, days }),
    onSuccess: () => { toast.ok('Plano atualizado'); void qc.invalidateQueries({ queryKey: ['admin-orgs'] }); void qc.invalidateQueries({ queryKey: ['admin-overview'] }); },
    onError: (e) => toast.err(e),
  });
  if (!s.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Administração da plataforma" description="Organizações, assinaturas e ações administrativas (todas auditadas)." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {[['Organizações', overview.data?.orgs], ['Ativas', overview.data?.active], ['Em teste', overview.data?.trial], ['Expiradas', overview.data?.expired], ['Isentas', overview.data?.exempt]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><p className="text-[13px] text-muted">{l}</p><p className="num mt-1 text-xl font-semibold">{int(v as number)}</p></div>
        ))}
        <div className="card p-4"><p className="text-[13px] text-muted">Recebido 30 dias</p><p className="num mt-1 text-xl font-semibold">{overview.data ? money(overview.data.revenueLast30dMinor, 'BRL') : '—'}</p></div>
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          <Input aria-label="Buscar" placeholder="Buscar por nome ou e-mail" className="min-w-[220px] flex-1" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Status" className="w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['all', 'trial', 'active', 'expired', 'exempt'].map((x) => <option key={x} value={x}>{{ all: 'Todos', trial: 'Em teste', active: 'Ativas', expired: 'Expiradas', exempt: 'Isentas' }[x]}</option>)}
          </Select>
        </div>
        {orgs.isError ? <ErrorState error={orgs.error} /> : !orgs.data ? <Skeleton className="m-4 h-40" /> : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[960px]">
              <thead><tr><th>Organização</th><th>Plano</th><th>Expira</th><th className="text-right">Pixels</th><th className="text-right">Vendas 30d</th><th>Último pagamento</th><th className="text-right">Ações</th></tr></thead>
              <tbody>{orgs.data.orgs.map((o: any) => (
                <tr key={o.id}>
                  <td><p className="font-medium">{o.name}</p><p className="text-xs text-muted">{o.owner_email}</p></td>
                  <td><Badge tone={STATUS_TONE[o.plan_status] ?? 'neutral'}>{o.plan_status}</Badge></td>
                  <td className="whitespace-nowrap text-muted">{dateTime(o.plan_expires_at)}</td>
                  <td className="num text-right">{o.pixels}</td>
                  <td className="num text-right">{o.sales_30d}</td>
                  <td className="text-muted">{dateTime(o.last_paid_at)}</td>
                  <td className="text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      <Button size="sm" onClick={() => act.mutate({ id: o.id, action: 'extend_trial', days: 7 })}>+7d teste</Button>
                      <Button size="sm" onClick={() => act.mutate({ id: o.id, action: 'activate', days: 30 })}>Ativar 30d</Button>
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: o.id, action: 'exempt' })}>Isentar</Button>
                      {o.id !== s.org.id && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: o.id, action: 'expire' })}>Expirar</Button>}
                      {o.id !== s.org.id && <Button size="sm" variant="ghost" className="text-err" onClick={async () => {
                        if (prompt(`Para excluir "${o.name}" e TODOS os dados, digite EXCLUIR`) !== 'EXCLUIR') return;
                        try { await del(`/v1/admin/orgs/${o.id}`, { confirm: 'EXCLUIR' }); toast.ok('Organização excluída'); void qc.invalidateQueries({ queryKey: ['admin-orgs'] }); } catch (e) { toast.err(e); }
                      }}>Excluir</Button>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
