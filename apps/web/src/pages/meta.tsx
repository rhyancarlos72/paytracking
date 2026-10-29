import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, CodeBlock, ConfirmButton, EmptyState, ErrorState, Select, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../lib/session';

export default function MetaPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const status = useQuery({ queryKey: ['meta-status'], queryFn: () => get('/v1/meta/status') });
  const conn = status.data?.connection;
  const accounts = useQuery({ queryKey: ['meta-accounts'], queryFn: () => get('/v1/meta/ad-accounts'), enabled: !!conn && conn.status === 'active' });
  useEffect(() => {
    if (sp.get('connected')) { toast.ok('Facebook Ads conectado'); setSp({}, { replace: true }); }
    if (sp.get('error')) { toast.err(new Error(sp.get('error')!), 'Conexão não concluída'); setSp({}, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = useMutation({ mutationFn: () => post<{ url: string }>('/v1/meta/connect'), onSuccess: (r) => { location.href = r.url; }, onError: (e) => toast.err(e) });
  const select = useMutation({
    mutationFn: (a: { accountId: string; currency: string }) => post('/v1/meta/ad-account', a),
    onSuccess: () => { toast.ok('Conta de anúncios selecionada'); void qc.invalidateQueries(); },
    onError: (e) => toast.err(e),
  });
  const admin = s.can('admin');
  return (
    <>
      <PageHeader title="Meta Ads" description="Conexão OAuth com o Facebook Ads para ler campanhas e gastos. O token fica criptografado no servidor." />
      {status.isError ? <Card><ErrorState error={status.error} /></Card> : !status.data ? <Skeleton className="h-48" /> : (
        <div className="space-y-6">
          {!status.data.appConfigured && (
            <Callout tone="warn" title="App da Meta não configurado no servidor">Defina META_APP_ID e META_APP_SECRET. URL de redirecionamento OAuth a cadastrar no app:<div className="mt-2"><CodeBlock label="Redirect URI" code={status.data.redirectUri} /></div></Callout>
          )}
          {conn?.status === 'expired' && <Callout tone="err" title="A conexão expirou ou foi revogada" action={admin && <Button size="sm" variant="primary" onClick={() => connect.mutate()}>Reconectar</Button>}>{conn.last_error}</Callout>}
          <Card title="Conexão" actions={conn ? <Badge tone={conn.status === 'active' ? 'ok' : 'err'} dot>{conn.status === 'active' ? 'Conectado' : 'Expirado'}</Badge> : <Badge>Desconectado</Badge>}>
            {!conn ? (
              <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Conecte o Facebook Ads"
                description={status.data.loginMode === 'business_login' ? 'Usamos o Login do Facebook para Empresas. Conceda acesso às contas de anúncios que deseja acompanhar.' : 'Solicitaremos ads_read e ads_management (para pausar, duplicar e editar orçamento).'}
                action={admin && <Button variant="primary" icon={<ExternalLink className="h-4 w-4" />} loading={connect.isPending} disabled={!status.data.appConfigured} onClick={() => connect.mutate()}>Conectar com o Facebook</Button>} />
            ) : (
              <div className="space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted">Token válido até</dt><dd className="mt-0.5 font-medium">{conn.token_expires_at ? dateTime(conn.token_expires_at, s.org.timezone) : 'sem expiração informada'}</dd></div>
                  <div><dt className="text-muted">Permissões concedidas</dt><dd className="mt-0.5 font-medium">{conn.scopes?.length ? conn.scopes.join(', ') : '—'}</dd></div>
                  <div><dt className="text-muted">Graph API</dt><dd className="mt-0.5 font-medium">{status.data.graphVersion}</dd></div>
                </dl>
                {conn.scopes?.length > 0 && !conn.scopes.includes('ads_management') && <Callout tone="info" title="Somente leitura">Sem ads_management, pausar, duplicar e editar orçamento ficam indisponíveis.</Callout>}
                <div>
                  <p className="label">Conta de anúncios</p>
                  {accounts.isLoading ? <Skeleton className="h-10 w-80" /> : accounts.isError ? <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} /> : (
                    <Select aria-label="Conta de anúncios" className="max-w-md" value={accounts.data?.selected ?? ''} disabled={!admin}
                      onChange={(e) => { const a = accounts.data.accounts.find((x: any) => x.id === e.target.value); if (a) select.mutate({ accountId: a.id, currency: a.currency }); }}>
                      <option value="" disabled>Selecione…</option>
                      {(accounts.data?.accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.currency}) · {a.id}</option>)}
                    </Select>
                  )}
                  <p className="hint">O gasto é lido na moeda da conta e convertido para {s.currency} pela cotação diária.</p>
                </div>
                {admin && (
                  <div className="flex gap-2">
                    <Button onClick={() => connect.mutate()}>Reconectar</Button>
                    <ConfirmButton variant="ghost" danger title="Desconectar o Facebook Ads?" confirmLabel="Desconectar" onConfirm={async () => { await post('/v1/meta/disconnect'); await qc.invalidateQueries(); }}>Desconectar</ConfirmButton>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
