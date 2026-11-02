import clsx from 'clsx';
import { Logo as BrandLogo, LogoMark } from './logo';
import {
  Activity, BarChart3, BellRing, BookOpen, ChevronsUpDown, CreditCard, Eye, EyeOff, GitBranch, LayoutDashboard, LogOut, Megaphone, Menu, Moon,
  Lock, Plug, Plus, QrCode, Receipt, Search, Settings, Shield, Sparkles, Stethoscope, Sun, Target, X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { maskEmail, money, pct } from '../lib/format';
import { namesHidden as namesHiddenNow, setNamesHidden, useNamesHidden, useSyncHideNames } from '../lib/privacy';
import { useLogout, useSession } from '../lib/session';
import { CommandPalette, SHORTCUT, type Command } from './command';
import { SoundUnlockButton, useSaleNotifier } from './sale-notifier';
import { Avatar, Button, Callout } from './ui';

interface NavItem { to: string; label: string; icon: ReactNode; admin?: boolean; keywords?: string }
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Visão geral', items: [
    { to: '/', label: 'Resumo', icon: <LayoutDashboard />, keywords: 'dashboard inicio receita roas' },
    { to: '/campanhas', label: 'Campanhas', icon: <Megaphone />, keywords: 'anuncios meta ads' },
    { to: '/vendas', label: 'Vendas', icon: <Receipt />, keywords: 'pagamentos pedidos transacoes' },
  ] },
  { group: 'Rastreamento', items: [
    { to: '/eventos', label: 'Eventos', icon: <Activity />, keywords: 'pageview initiatecheckout capi' },
    { to: '/atribuicao', label: 'Atribuição', icon: <GitBranch />, keywords: 'utm origem' },
    { to: '/diagnostico', label: 'Diagnóstico', icon: <Stethoscope />, keywords: 'alertas falhas fila webhooks' },
  ] },
  { group: 'Configuração', items: [
    { to: '/pixels', label: 'Pixels', icon: <Target />, keywords: 'snippet token capi' },
    { to: '/integracoes', label: 'Integrações', icon: <Plug />, keywords: 'gateway kiwify hotmart checkout webhook' },
    { to: '/integracoes/meta', label: 'Meta Ads', icon: <BarChart3 />, keywords: 'facebook conta de anuncios' },
  ] },
  { group: 'Conta', items: [
    { to: '/configuracoes', label: 'Configurações', icon: <Settings />, keywords: 'equipe metas moeda fuso senha' },
    { to: '/financeiro', label: 'Financeiro', icon: <CreditCard />, keywords: 'assinatura plano pix' },
    { to: '/admin', label: 'Admin', icon: <Shield />, admin: true },
    { to: '/ajuda', label: 'Ajuda', icon: <BookOpen />, keywords: 'suporte documentacao' },
  ] },
];

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('pt_theme', next ? 'dark' : 'light'); } catch { /* */ }
  };
  return { dark, toggle };
}

/** Olho: esconde/mostra nomes de campanhas e pixels em todo o painel. */
function PrivacyToggle() {
  const hidden = useNamesHidden();
  return (
    <button onClick={() => void setNamesHidden(!hidden)} aria-pressed={hidden}
      title={hidden ? 'Mostrar nomes de campanhas e pixels' : 'Esconder nomes de campanhas e pixels (para prints e telas compartilhadas)'}
      aria-label={hidden ? 'Mostrar nomes de campanhas e pixels' : 'Esconder nomes de campanhas e pixels'}
      className={clsx('inline-flex items-center gap-1.5 rounded-lg p-2 transition', hidden ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/15' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
      {hidden ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      {hidden && <span className="hidden pr-0.5 text-xs font-semibold sm:inline">Nomes ocultos</span>}
    </button>
  );
}

function Logo({ compact }: { compact?: boolean }) {
  return compact ? <LogoMark className="h-8 w-8" /> : <BrandLogo markClassName="h-8 w-8" textClassName="text-[18px]" />;
}

/** Plano vencido (e não é o dono da plataforma): o painel fica atrás do aviso de pagamento. */
export function usePlanLocked() {
  const s = useSession();
  return s.plan.blocked && !s.user.isPlatformAdmin;
}

function useOpenAlerts() {
  const locked = usePlanLocked();
  const q = useQuery<{ alerts: Array<{ resolved_at: string | null }> }>({ queryKey: ['alerts'], queryFn: () => get('/v1/alerts'), refetchInterval: 60_000, staleTime: 30_000, enabled: !locked });
  return (q.data?.alerts ?? []).filter((a) => !a.resolved_at).length;
}

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const s = useSession();
  const logout = useLogout();
  const qc = useQueryClient();
  const [orgOpen, setOrgOpen] = useState(false);
  const alerts = useOpenAlerts();
  const trial = s.plan.status === 'trial' && s.plan.daysLeft !== null;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-5 pb-4 pt-5"><Logo /></div>

      <div className="relative px-3">
        <button onClick={() => s.orgs.length > 1 && setOrgOpen((v) => !v)} aria-expanded={s.orgs.length > 1 ? orgOpen : undefined}
          className={clsx('flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm transition', s.orgs.length > 1 && 'hover:border-border-strong')}>
          <Avatar name={s.org.name} className="h-7 w-7 rounded-lg text-[10px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{s.org.name}</span>
            <span className="block text-[11px] text-muted">{s.org.reportingCurrency ?? 'BRL'} · {s.org.timezone}</span>
          </span>
          {s.orgs.length > 1 && <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
        </button>
        {orgOpen && (
          <div className="absolute left-3 right-3 z-20 mt-1 rounded-xl border border-border bg-surface p-1 shadow-pop animate-scale-in">
            {s.orgs.map((o) => (
              <button key={o.id} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={async () => {
                await post('/v1/auth/switch-org', { orgId: o.id });
                await qc.invalidateQueries();
                setOrgOpen(false);
              }}><Avatar name={o.name} className="h-6 w-6 rounded-md text-[9px]" />{o.name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 pt-3">
        <button onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 text-[13px] text-muted transition hover:border-border-strong hover:text-fg">
          <Search className="h-4 w-4" aria-hidden /><span className="flex-1 text-left">Buscar…</span><span className="kbd">{SHORTCUT}</span>
        </button>
      </div>

      <nav className="space-y-5 px-3 py-5" aria-label="Navegação principal">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.filter((i) => !i.admin || s.user.isPlatformAdmin).map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.to === '/' || i.to === '/integracoes'} onClick={onNavigate}
                    className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all [&>svg]:h-[18px] [&>svg]:w-[18px]',
                      isActive ? 'bg-gradient-to-b from-[#3b82f6] to-[#2563eb] font-semibold text-white shadow-[0_8px_20px_-10px_rgb(37_99_235/0.9),inset_0_1px_0_rgb(255_255_255/0.18)]' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                    {() => (<>
                      {i.icon}
                      <span className="flex-1">{i.label}</span>
                      {i.to === '/diagnostico' && alerts > 0 && (
                        <span className="rounded-full bg-err px-1.5 py-px text-[11px] font-semibold text-err-fg" aria-label={`${alerts} alertas abertos`}>{alerts}</span>
                      )}
                    </>)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex-1" aria-hidden />
      <MonthGoal onNavigate={onNavigate} />

      {trial && (
        <div className="mx-3 mb-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden />Teste grátis</p>
          <p className="mt-0.5 text-xs text-muted">{s.plan.daysLeft} dia(s) restante(s)</p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-[#60a5fa] to-[#2563eb]" style={{ width: `${Math.max(6, Math.min(100, ((7 - (s.plan.daysLeft ?? 0)) / 7) * 100))}%` }} />
          </div>
          <Link to="/financeiro" onClick={onNavigate} className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Assinar agora →</Link>
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <Avatar name={s.user.name ?? s.user.email} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{s.user.name ?? 'Minha conta'}</p>
            <p className="truncate text-xs text-muted">{s.user.hideEmail ? maskEmail(s.user.email) : s.user.email}</p>
          </div>
          <button onClick={logout} className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Sair" title="Sair"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

/** "Meta do mês": progresso da receita confirmada no mês contra a meta mensal da conta. */
function MonthGoal({ onNavigate }: { onNavigate?: () => void }) {
  const locked = usePlanLocked();
  const q = useQuery<{ currency: string; goalMinor: string; achievedMinor: string }>({
    queryKey: ['monthly-goal'], queryFn: ({ signal }) => get('/v1/reports/monthly-goal', signal), refetchInterval: 120_000, staleTime: 60_000, enabled: !locked,
  });
  if (!q.data) return null;
  const goal = Number(q.data.goalMinor);
  const done = Number(q.data.achievedMinor);
  const p = goal > 0 ? Math.min(1, done / goal) : 0;
  const left = Math.max(0, goal - done);
  return (
    <div className="mx-3 mb-3 rounded-2xl border border-border bg-surface-2/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Meta do mês</p>
        {goal > 0 && <span className="num text-xs font-bold text-primary">{pct(p, 0)}</span>}
      </div>
      {goal > 0 ? (<>
        <p className="num mt-1.5 text-[15px] font-bold">{money(q.data.achievedMinor, q.data.currency)}<span className="text-xs font-medium text-muted"> / {money(q.data.goalMinor, q.data.currency)}</span></p>
        <div className="meter mt-2.5" role="progressbar" aria-label="Meta do mês" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <span className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb]" style={{ width: `${Math.max(3, p * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">{p >= 1 ? <span className="font-semibold text-ok">Meta batida 🎉</span> : <>{pct(p, 0)} concluído · faltam <span className="num font-semibold text-fg">{money(String(left), q.data.currency)}</span></>}</p>
      </>) : (
        <Link to="/configuracoes" onClick={onNavigate} className="mt-1.5 block text-xs text-muted hover:text-fg">Defina uma meta mensal para acompanhar aqui <span className="font-semibold text-primary">→</span></Link>
      )}
    </div>
  );
}

function StatusPill() {
  const alerts = useOpenAlerts();
  return (
    <Link to="/diagnostico" className={clsx('hidden items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition sm:inline-flex',
      alerts > 0 ? 'border-warn/30 bg-warn/10 text-warn hover:bg-warn/15' : 'border-border bg-surface text-muted hover:text-fg')}>
      {alerts > 0
        ? <><span className="h-2 w-2 rounded-full bg-warn" aria-hidden />{alerts} alerta{alerts > 1 ? 's' : ''}</>
        : <><span className="live-dot" aria-hidden />Operação normal</>}
    </Link>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const { dark, toggle } = useTheme();
  const s = useSession();
  useSyncHideNames(s.user.hideNames); // o "olho" segue a conta em qualquer aparelho
  const loc = useLocation();
  const nav = useNavigate();
  const logout = useLogout();
  const locked = usePlanLocked();
  const allowed = ['/financeiro', '/configuracoes', '/ajuda'].some((p) => loc.pathname.startsWith(p));
  useSaleNotifier(!locked);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands = useMemo<Command[]>(() => [
    ...NAV.flatMap((g) => g.items.filter((i) => !i.admin || s.user.isPlatformAdmin).map((i) => ({
      id: `nav:${i.to}`, label: i.label, group: 'Ir para', icon: i.icon, keywords: i.keywords, run: () => nav(i.to),
    }))),
    ...(s.can('admin') ? [
      { id: 'act:pixel', label: 'Novo pixel', group: 'Ações', icon: <Plus />, keywords: 'criar adicionar', run: () => nav('/pixels?novo=1') },
      { id: 'act:integ', label: 'Nova integração', group: 'Ações', icon: <Plug />, keywords: 'gateway checkout webhook', run: () => nav('/integracoes?nova=1') },
    ] : []),
    { id: 'act:notif', label: 'Notificações no celular e som de venda', group: 'Ações', icon: <BellRing />, keywords: 'push celular som alerta aviso', run: () => nav('/configuracoes?aba=notificacoes') },
    { id: 'act:hide', label: 'Esconder/mostrar nomes de campanhas e pixels', group: 'Ações', icon: <EyeOff />, keywords: 'olho ocultar privado print gravar compartilhar tela nomes', run: () => void setNamesHidden(!namesHiddenNow()) },
    { id: 'act:2fa', label: 'Segurança da conta', group: 'Ações', icon: <Shield />, keywords: 'senha sessões duas etapas 2fa', run: () => nav('/configuracoes?aba=seguranca') },
    { id: 'act:theme', label: dark ? 'Usar tema claro' : 'Usar tema escuro', group: 'Ações', icon: dark ? <Sun /> : <Moon />, keywords: 'tema escuro claro dark light', run: toggle },
    { id: 'act:logout', label: 'Sair', group: 'Ações', icon: <LogOut />, keywords: 'logout encerrar', run: logout },
  ], [s, dark, nav, toggle, logout]);

  return (
    <div className="min-h-screen lg:pl-[264px]">
      <div className="aurora" aria-hidden />
      <a href="#conteudo" className="btn-primary sr-only z-50 rounded-xl px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-border bg-surface lg:block"><Sidebar onSearch={() => setPalette(true)} /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[284px] border-r border-border bg-surface shadow-pop animate-slide-in-left">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fechar menu"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} onSearch={() => { setOpen(false); setPalette(true); }} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border/70 bg-bg/70 px-4 backdrop-blur-xl lg:px-8">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
          <span className="lg:hidden"><Logo /></span>
          <button onClick={() => setPalette(true)} className="hidden h-9 w-72 items-center gap-2 rounded-xl border border-border bg-surface/70 px-3 text-[13px] text-muted shadow-sm transition hover:border-border-strong hover:text-fg lg:flex">
            <Search className="h-4 w-4" aria-hidden /><span className="flex-1 text-left">Buscar páginas e ações…</span><span className="kbd">{SHORTCUT}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <SoundUnlockButton />
          <StatusPill />
          <button onClick={() => setPalette(true)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg lg:hidden" aria-label="Buscar"><Search className="h-[18px] w-[18px]" /></button>
          <PrivacyToggle />
          <button onClick={toggle} className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-fg" aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>
            {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none lg:px-8 lg:py-8">
        {locked && allowed && !loc.pathname.startsWith('/financeiro') && (
          <div className="mb-6">
            <Callout tone="warn" title="Assinatura vencida" action={<Link to="/financeiro" className="btn-primary inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold">Pagar agora</Link>}>
              Pague sua assinatura para liberar o acesso ao painel e às suas vendas.
            </Callout>
          </div>
        )}
        {!s.user.emailVerified && <VerifyBanner />}
        {locked && !allowed ? <Paywall /> : <div key={loc.pathname} className="animate-slide-up"><Outlet /></div>}
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
    </div>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  return (
    <div className="mb-6">
      <Callout tone="warn" title="Confirme seu e-mail" action={
        <Button size="sm" disabled={sent} onClick={async () => { await post('/v1/auth/resend-verification'); setSent(true); }}>{sent ? 'Enviado' : 'Reenviar link'}</Button>
      }>Enviamos um link de confirmação. Isso protege a recuperação de acesso à sua conta.</Callout>
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  useEffect(() => { document.title = `${title} · PayTracking`; }, [title]);
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[13px] font-semibold text-primary">{eyebrow}</p>}
        <h1 className="text-[28px] font-bold leading-tight lg:text-[34px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Assinatura vencida: no lugar da aba, um aviso que não sai até pagar (Financeiro, Configurações e Ajuda continuam abertos). */
function Paywall() {
  const s = useSession();
  useEffect(() => { document.title = 'Assinatura vencida · PayTracking'; }, []);
  const owner = s.can('owner');
  const price = money(s.plan.priceMinor, 'BRL');
  return (
    <div className="relative min-h-[70vh]">
      {/* painel "fantasma" desfocado atrás do aviso */}
      <div className="pointer-events-none select-none space-y-6 opacity-40 blur-[6px]" aria-hidden>
        <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]"><div className="hero-blue h-56" /><div className="card-gold h-56" /></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-36" />)}</div>
        <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]"><div className="card h-72" /><div className="card h-72" /></div>
      </div>
      <div className="absolute inset-0 flex items-start justify-center px-2 pt-6 sm:pt-16">
        <section role="alertdialog" aria-modal="false" aria-labelledby="paywall-title" aria-describedby="paywall-desc"
          className="w-full max-w-md rounded-[24px] border border-border bg-surface p-7 text-center shadow-pop animate-scale-in">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500 ring-1 ring-inset ring-amber-400/30 dark:text-amber-300"><Lock className="h-7 w-7" aria-hidden /></span>
          <h2 id="paywall-title" className="mt-5 text-xl font-bold">Assinatura vencida</h2>
          <p id="paywall-desc" className="mt-2 text-[15px] font-medium">Pague sua assinatura para liberar o acesso ao painel e às suas vendas.</p>
          <p className="mt-2 text-sm text-muted">Seus pixels, integrações e vendas continuam guardados. Assim que o PIX de {price} for confirmado, tudo volta na hora, por mais 30 dias.</p>
          {owner ? (
            <Link to="/financeiro?pagar=1" className="btn-primary mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold">
              <QrCode className="h-5 w-5" aria-hidden />Pagar com PIX · {price}
            </Link>
          ) : (
            <p className="mt-5 rounded-xl bg-warn/10 px-4 py-3 text-sm font-medium text-warn">Somente o proprietário da organização pode pagar. Avise o responsável pela conta.</p>
          )}
          <Link to="/financeiro" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Ver detalhes da assinatura</Link>
        </section>
      </div>
    </div>
  );
}
