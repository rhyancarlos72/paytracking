import clsx from 'clsx';
import {
  Activity, BarChart3, BookOpen, ChevronDown, CreditCard, GitBranch, LayoutDashboard, LogOut, Megaphone, Menu, Moon,
  Plug, Receipt, Settings, Shield, Stethoscope, Sun, Target, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { maskEmail } from '../lib/format';
import { useLogout, useSession } from '../lib/session';
import { Badge, Callout, Button } from './ui';

const NAV: Array<{ group: string; items: Array<{ to: string; label: string; icon: ReactNode; admin?: boolean }> }> = [
  { group: 'Visão geral', items: [
    { to: '/', label: 'Resumo', icon: <LayoutDashboard /> },
    { to: '/campanhas', label: 'Campanhas', icon: <Megaphone /> },
    { to: '/vendas', label: 'Vendas', icon: <Receipt /> },
  ] },
  { group: 'Rastreamento', items: [
    { to: '/eventos', label: 'Eventos', icon: <Activity /> },
    { to: '/atribuicao', label: 'Atribuição', icon: <GitBranch /> },
    { to: '/diagnostico', label: 'Diagnóstico', icon: <Stethoscope /> },
  ] },
  { group: 'Configuração', items: [
    { to: '/pixels', label: 'Pixels', icon: <Target /> },
    { to: '/integracoes', label: 'Integrações', icon: <Plug /> },
    { to: '/integracoes/meta', label: 'Meta Ads', icon: <BarChart3 /> },
  ] },
  { group: 'Conta', items: [
    { to: '/configuracoes', label: 'Configurações', icon: <Settings /> },
    { to: '/financeiro', label: 'Financeiro', icon: <CreditCard /> },
    { to: '/admin', label: 'Admin', icon: <Shield />, admin: true },
    { to: '/ajuda', label: 'Ajuda', icon: <BookOpen /> },
  ] },
];

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('pt_theme', next ? 'dark' : 'light'); } catch { /* */ }
  };
  return { dark, toggle };
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className="text-[15px] font-semibold tracking-tight">PayTracking</span>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const s = useSession();
  const logout = useLogout();
  const qc = useQueryClient();
  const [orgOpen, setOrgOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-3 pt-4"><Logo /></div>
      {s.orgs.length > 1 && (
        <div className="relative px-3 pb-2">
          <button onClick={() => setOrgOpen((v) => !v)} className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2" aria-expanded={orgOpen}>
            <span className="truncate font-medium">{s.org.name}</span><ChevronDown className="h-4 w-4 text-muted" />
          </button>
          {orgOpen && (
            <div className="absolute left-3 right-3 z-20 mt-1 rounded-lg border border-border bg-surface p-1 shadow-pop">
              {s.orgs.map((o) => (
                <button key={o.id} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={async () => {
                  await post('/v1/auth/switch-org', { orgId: o.id });
                  await qc.invalidateQueries();
                  setOrgOpen(false);
                }}>{o.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Navegação principal">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.filter((i) => !i.admin || s.user.isPlatformAdmin).map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.to === '/' || i.to === '/integracoes'} onClick={onNavigate}
                    className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&>svg]:h-[18px] [&>svg]:w-[18px]',
                      isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                    {i.icon}{i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {(s.user.name ?? s.user.email)[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{s.user.name ?? 'Minha conta'}</p>
            <p className="truncate text-xs text-muted">{s.user.hideEmail ? maskEmail(s.user.email) : s.user.email}</p>
          </div>
          <button onClick={logout} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Sair" title="Sair"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useTheme();
  const s = useSession();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#conteudo" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface shadow-pop animate-fade-in">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label="Fechar menu"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
          <span className="lg:hidden"><Logo /></span>
        </div>
        <div className="flex items-center gap-2">
          {s.plan.status === 'trial' && <Badge tone="info">Teste grátis · {s.plan.daysLeft} dia(s)</Badge>}
          <button onClick={toggle} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>
            {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="mx-auto w-full outline-none max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
        {!s.user.emailVerified && <VerifyBanner />}
        <Outlet />
      </main>
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

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  useEffect(() => { document.title = `${title} · PayTracking`; }, [title]);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight lg:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
