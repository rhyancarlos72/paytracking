import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Ban, CheckCircle2, CreditCard, Mail, MonitorSmartphone, Search, ShieldCheck, Target, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../components/toast';
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Pager, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { dateTime, int, money, PROVIDER_LABEL, relative } from '../lib/format';

interface Flag { code: string; label: string }
interface AdminUser {
  id: string; email: string; name: string | null; createdAt: string; lastSeenAt: string | null;
  emailVerified: boolean; google: boolean; twoFactor: boolean; blocked: { at: string; reason: string | null } | null;
  org: { id: string; name: string; role: string; planStatus: string; planExpiresAt: string | null; count: number } | null;
  billing: { paidCount: number; paidTotalMinor: string; lastPaidAt: string | null };
  usage: { pixels: number; pixelsActive: number; providers: string[]; metaConnected: boolean; sales30d: number; events3d: number };
  flags: Flag[];
}
interface ListResp { users: AdminUser[]; counts: { total: number; risk: number; blocked: number; paid: number; no_pixel: number }; page: number; pageSize: number }

const FILTERS = [
  { v: 'all', l: 'Todos', c: 'total' }, { v: 'risk', l: 'Sinais para conferir', c: 'risk' }, { v: 'paid', l: 'Pagantes', c: 'paid' },
  { v: 'unpaid', l: 'Nunca pagaram' }, { v: 'trial', l: 'Em teste' }, { v: 'no_pixel', l: 'Sem pixel', c: 'no_pixel' }, { v: 'blocked', l: 'Bloqueados', c: 'blocked' },
] as const;

const PLAN: Record<string, { l: string; tone: 'ok' | 'warn' | 'err' | 'info' | 'neutral' }> = {
  active: { l: 'Ativa', tone: 'ok' }, trial: { l: 'Teste grátis', tone: 'info' }, expired: { l: 'Vencida', tone: 'err' }, exempt: { l: 'Isenta', tone: 'neutral' },
};

const ACTION: Record<string, string> = {
  'account.created': 'Criou a conta', 'auth.login': 'Entrou com e-mail e senha', 'auth.login_google': 'Entrou com Google',
  'auth.login_failed': 'Errou a senha', 'auth.2fa_failed': 'Errou o código de 2 etapas', 'auth.password_changed': 'Trocou a senha',
  'auth.password_reset': 'Redefiniu a senha', 'auth.google_linked': 'Ligou o login com Google', 'auth.2fa_enabled': 'Ativou a verificação em 2 etapas',
  'auth.2fa_disabled': 'Desativou a verificação em 2 etapas', 'auth.2fa_recovery_used': 'Usou código de recuperação', 'auth.2fa_recovery_regenerated': 'Gerou novos códigos de recuperação',
  'pixel.created': 'Criou um pixel', 'pixel.updated': 'Editou um pixel', 'pixel.deleted': 'Excluiu um pixel', 'pixel.toggled': 'Ligou/desligou um pixel',
  'pixel.key_rotated': 'Trocou a chave de um pixel', 'pixel.activate_all': 'Ativou todos os pixels', 'pixel.deactivate_all': 'Desativou todos os pixels',
  'integration.created': 'Conectou uma integração', 'integration.updated': 'Editou uma integração', 'integration.deleted': 'Removeu uma integração', 'integration.token_rotated': 'Trocou o token de uma integração',
  'meta.connected': 'Conectou o Meta Ads', 'meta.disconnected': 'Desconectou o Meta Ads', 'meta.ad_account_selected': 'Escolheu a conta de anúncios',
  'meta.status_changed': 'Pausou/ativou campanha ou conjunto', 'meta.budget_changed': 'Alterou orçamento', 'meta.duplicated': 'Duplicou campanha ou conjunto',
  'member.invited': 'Convidou alguém para a equipe', 'member.removed': 'Removeu alguém da equipe', 'member.role_changed': 'Mudou o papel de alguém',
  'org.updated': 'Alterou dados da loja', 'billing.paid': 'Pagou a assinatura', 'capi.requeued': 'Reprocessou eventos', 'payments.fix_duplicates': 'Corrigiu vendas duplicadas',
};
const RISKY = new Set(['auth.login_failed', 'auth.2fa_failed', 'auth.2fa_disabled', 'pixel.deactivate_all']);

export function AdminUsers() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery<ListResp>({
    queryKey: ['admin-users', filter, search, page],
    queryFn: ({ signal }) => get(`/v1/admin/users${qs({ filter, q: search || undefined, page })}`, signal),
    placeholderData: (p) => p,
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Filtrar usuários" className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5">
          {FILTERS.map((f) => {
            const n = 'c' in f ? q.data?.counts[f.c as keyof ListResp['counts']] : undefined;
            const on = filter === f.v;
            return (
              <button key={f.v} role="radio" aria-checked={on} onClick={() => { setFilter(f.v); setPage(1); }}
                className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition',
                  on ? 'bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {f.v === 'risk' && <AlertTriangle className={clsx('h-3.5 w-3.5', !on && 'text-warn')} aria-hidden />}{f.l}
                {n !== undefined && <span className={clsx('rounded-full px-1.5 text-[11px]', on ? 'bg-white/20' : f.v === 'risk' && n > 0 ? 'bg-warn/15 text-warn' : 'bg-surface-3')}>{int(n)}</span>}
              </button>
            );
          })}
        </div>
        <form className="relative min-w-[220px] flex-1" onSubmit={(e) => e.preventDefault()}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar usuário" placeholder="Buscar por e-mail, nome ou loja" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </form>
      </div>

      <section className="card overflow-hidden">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : q.data.users.length === 0 ? <EmptyState icon={<Search />} title="Ninguém por aqui" description="Nenhum usuário neste filtro." />
          : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[1100px]">
                <thead><tr><th>Usuário</th><th>Acesso</th><th>Plano</th><th>Pagamento</th><th>Configurou</th><th className="text-right">Uso</th><th>Sinais</th></tr></thead>
                <tbody>{q.data.users.map((u) => (
                  <tr key={u.id} className={clsx('cursor-pointer', u.blocked && 'bg-err/[0.04]')} onClick={() => setOpen(u.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setOpen(u.id); }} aria-label={`Abrir ${u.email}`}>
                    <td className="max-w-[260px]">
                      <p className="truncate font-semibold">{u.name ?? '—'}</p>
                      <p className="truncate text-xs text-muted">{u.email}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.blocked && <Badge tone="err">Bloqueado</Badge>}
                        {u.google && <Badge tone="neutral">Google</Badge>}
                        {u.twoFactor && <Badge tone="ok">2FA</Badge>}
                        {!u.emailVerified && <Badge tone="warn">E-mail não confirmado</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
                      <p>Último: <span className="font-medium">{u.lastSeenAt ? relative(u.lastSeenAt) : 'nunca'}</span></p>
                      <p className="text-xs text-muted">Cadastro {dateTime(u.createdAt)}</p>
                    </td>
                    <td className="whitespace-nowrap">
                      {u.org ? <><Badge tone={PLAN[u.org.planStatus]?.tone ?? 'neutral'} dot>{PLAN[u.org.planStatus]?.l ?? u.org.planStatus}</Badge>
                        {u.org.planExpiresAt && <p className="mt-1 text-xs text-muted">até {dateTime(u.org.planExpiresAt)}</p>}</> : <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
                      {u.billing.paidCount > 0
                        ? <><p className="font-semibold text-ok">{int(u.billing.paidCount)}× · {money(u.billing.paidTotalMinor, 'BRL')}</p><p className="text-xs text-muted">último {relative(u.billing.lastPaidAt!)}</p></>
                        : <span className="text-muted">nunca pagou</span>}
                    </td>
                    <td className="text-[13px]">
                      <p className={u.usage.pixels ? '' : 'text-warn'}>{u.usage.pixels ? `${int(u.usage.pixels)} pixel${u.usage.pixels > 1 ? 's' : ''} (${int(u.usage.pixelsActive)} ativo${u.usage.pixelsActive === 1 ? '' : 's'})` : 'sem pixel'}</p>
                      <p className="text-xs text-muted">{u.usage.providers.length ? u.usage.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ') : 'sem integração'}{u.usage.metaConnected ? ' · Meta Ads' : ''}</p>
                    </td>
                    <td className="whitespace-nowrap text-right text-[13px]">
                      <p><span className="num font-semibold">{int(u.usage.sales30d)}</span> <span className="text-muted">vendas 30d</span></p>
                      <p className="text-xs text-muted"><span className="num">{int(u.usage.events3d)}</span> eventos 3d</p>
                    </td>
                    <td>{u.flags.length ? <span title={u.flags.map((f) => f.label).join('\n')} className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn ring-1 ring-inset ring-warn/25"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{u.flags.length}</span> : <span className="text-xs text-muted">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        {q.data && q.data.users.length > 0 && (
          <div className="border-t border-border p-3"><Pager page={page} hasNext={q.data.users.length === q.data.pageSize} onPage={setPage} /></div>
        )}
      </section>
      <p className="mt-3 text-xs text-muted">Mostramos só quantidades do que cada conta configurou — nunca ID, nome ou chave dos pixels, nem dados das vendas dos clientes. IPs aparecem mascarados.</p>
      <UserDetail id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function UserDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const d = useQuery<{ user: AdminUser; orgs: Array<{ id: string; name: string; role: string; plan_status: string }>; sessions: Array<{ ip: string | null; device: string | null; createdAt: string; lastSeenAt: string; active: boolean }>; activity: Array<{ action: string; at: string; ip: string | null }> }>({
    queryKey: ['admin-user', id], queryFn: ({ signal }) => get(`/v1/admin/users/${id}`, signal), enabled: !!id,
  });
  const block = useMutation({
    mutationFn: (blocked: boolean) => post(`/v1/admin/users/${id}/block`, { blocked, reason: reason.trim() || undefined }),
    onSuccess: (_r, blocked) => {
      toast.ok(blocked ? 'Acesso bloqueado' : 'Acesso liberado', blocked ? 'A pessoa saiu de todos os aparelhos e não consegue entrar.' : undefined);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-user', id] });
    },
    onError: (e) => toast.err(e),
  });
  const u = d.data?.user;
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={u ? (u.name ?? u.email) : 'Usuário'} description={u?.email}>
      {!d.data || !u ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          {u.blocked && <div className="rounded-xl bg-err/10 px-4 py-3 text-sm text-err ring-1 ring-inset ring-err/20"><b>Bloqueado</b> {relative(u.blocked.at)}{u.blocked.reason ? ` — ${u.blocked.reason}` : ''}</div>}
          {u.flags.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold">Sinais para conferir</p>
              {u.flags.map((f) => <p key={f.code} className="flex gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn ring-1 ring-inset ring-warn/20"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{f.label}</p>)}
              <p className="text-xs text-muted">São indícios, não provas: confira a atividade abaixo antes de bloquear.</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Info icon={<CreditCard />} title="Pagamento" lines={[u.billing.paidCount ? `${u.billing.paidCount}× · ${money(u.billing.paidTotalMinor, 'BRL')}` : 'Nunca pagou', u.billing.lastPaidAt ? `último em ${dateTime(u.billing.lastPaidAt)}` : (u.org ? `plano: ${PLAN[u.org.planStatus]?.l ?? u.org.planStatus}` : '')]} />
            <Info icon={<Target />} title="Configuração" lines={[u.usage.pixels ? `${u.usage.pixels} pixel(s), ${u.usage.pixelsActive} ativo(s)` : 'Sem pixel', u.usage.providers.length ? u.usage.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ') : 'Sem integração', u.usage.metaConnected ? 'Meta Ads conectado' : 'Meta Ads não conectado']} />
            <Info icon={<ShieldCheck />} title="Conta" lines={[u.google ? 'Entra com Google' : 'Entra com e-mail e senha', u.twoFactor ? '2 etapas ativa' : '2 etapas desligada', u.emailVerified ? 'E-mail confirmado' : 'E-mail NÃO confirmado']} />
          </div>
          {d.data.orgs.length > 1 && <p className="text-xs text-muted">Participa de {d.data.orgs.length} lojas: {d.data.orgs.map((o) => `${o.name} (${o.role})`).join(', ')}</p>}

          <div>
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><MonitorSmartphone className="h-4 w-4 text-muted" aria-hidden />Aparelhos e acessos</p>
            {d.data.sessions.length === 0 ? <p className="text-sm text-muted">Nenhum acesso ainda.</p> : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {d.data.sessions.map((x, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-muted" title={x.device ?? ''}>{shortDevice(x.device)}</span>
                    <span className="font-mono text-xs">{x.ip ?? '—'}</span>
                    <span className="text-xs text-muted">{relative(x.lastSeenAt)}</span>
                    {x.active && <Badge tone="ok">conectado</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-[13px] font-semibold">Atividade recente</p>
            {d.data.activity.length === 0 ? <p className="text-sm text-muted">Sem atividade registrada.</p> : (
              <ol className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                {d.data.activity.map((a, i) => (
                  <li key={i} className={clsx('flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px]', RISKY.has(a.action) && 'bg-warn/10 text-warn')}>
                    {RISKY.has(a.action) ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{ACTION[a.action] ?? a.action}</span>
                    {a.ip && <span className="font-mono text-xs text-muted">{a.ip}</span>}
                    <span className="whitespace-nowrap text-xs text-muted">{dateTime(a.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            {u.blocked ? (
              <Button variant="primary" icon={<Unlock className="h-4 w-4" />} loading={block.isPending} onClick={() => block.mutate(false)}>Desbloquear acesso</Button>
            ) : (<>
              <label className="min-w-[220px] flex-1"><span className="label">Motivo do bloqueio (só você vê)</span>
                <Input value={reason} maxLength={200} placeholder="Ex.: várias contas para repetir o teste grátis" onChange={(e) => setReason(e.target.value)} /></label>
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} loading={block.isPending}
                onClick={() => { if (confirm(`Bloquear o acesso de ${u.email}? A pessoa sai de todos os aparelhos na hora.`)) block.mutate(true); }}>Bloquear acesso</Button>
            </>)}
            <a href={`mailto:${u.email}`} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-surface-2"><Mail className="h-4 w-4" aria-hidden />Enviar e-mail</a>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold"><span className="text-primary [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>{title}</p>
      <ul className="mt-2 space-y-0.5 text-[13px] text-muted">{lines.filter(Boolean).map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

/** "Chrome no Windows", "Safari no iPhone"… a partir do user agent. */
function shortDevice(ua: string | null): string {
  if (!ua) return 'Navegador desconhecido';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro sistema';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} no ${os}`;
}
