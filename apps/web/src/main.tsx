import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy as reactLazy, StrictMode, Suspense, useEffect, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './styles/index.css';
import './lib/push-client'; // captura o pedido de instalação do app (Android) desde o início
import { AppShell } from './components/shell';
import { ToastProvider } from './components/toast';
import { Spinner } from './components/ui';
import { onApiError } from './lib/api';
import { useMe } from './lib/session';

// Divisão de código por página (carregamento sob demanda). Se um deploy novo trocou os arquivos
// enquanto a aba estava aberta, o chunk antigo não existe mais: recarrega a página uma vez.
const flag = {
  get: () => { try { return sessionStorage.getItem('pt_chunk_reload'); } catch { return '1'; } },
  set: (v: string | null) => { try { if (v) sessionStorage.setItem('pt_chunk_reload', v); else sessionStorage.removeItem('pt_chunk_reload'); } catch { /* */ } },
};
function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return reactLazy(() => load().then((m) => { flag.set(null); return m; }, (e) => {
    if (!flag.get()) {
      flag.set('1');
      location.reload();
      return new Promise<{ default: T }>(() => undefined);
    }
    throw e;
  }));
}

const Login = lazy(() => import('./pages/auth').then((m) => ({ default: m.LoginPage })));
const Signup = lazy(() => import('./pages/auth').then((m) => ({ default: m.SignupPage })));
const Forgot = lazy(() => import('./pages/auth').then((m) => ({ default: m.ForgotPage })));
const Reset = lazy(() => import('./pages/auth').then((m) => ({ default: m.ResetPage })));
const VerifyEmail = lazy(() => import('./pages/auth').then((m) => ({ default: m.VerifyEmailPage })));
const Invite = lazy(() => import('./pages/auth').then((m) => ({ default: m.InvitePage })));
const Dashboard = lazy(() => import('./pages/dashboard'));
const Campaigns = lazy(() => import('./pages/campaigns'));
const Sales = lazy(() => import('./pages/sales'));
const SaleDetail = lazy(() => import('./pages/sale-detail'));
const Events = lazy(() => import('./pages/events'));
const Attribution = lazy(() => import('./pages/attribution'));
const Diagnostics = lazy(() => import('./pages/diagnostics'));
const Pixels = lazy(() => import('./pages/pixels'));
const Integrations = lazy(() => import('./pages/integrations'));
const MetaAds = lazy(() => import('./pages/meta'));
const Settings = lazy(() => import('./pages/settings'));
const Billing = lazy(() => import('./pages/billing'));
const Admin = lazy(() => import('./pages/admin'));
const Help = lazy(() => import('./pages/help'));

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e: any) => n < 2 && (e?.status === 0 || e?.status >= 500), refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const Loading = () => <div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-6 w-6" /></div>;
const ALLOWED_WHEN_EXPIRED = ['/financeiro', '/configuracoes', '/ajuda'];

function Protected() {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => onApiError((e) => {
    if (e.status === 401) qc.setQueryData(['me'], null);
    if (e.status === 402) nav('/financeiro?expirado=1');
  }), [nav]);
  if (isLoading) return <Loading />;
  if (!data) return <Navigate to={`/entrar?voltar=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (data.plan.blocked && !data.user.isPlatformAdmin && !ALLOWED_WHEN_EXPIRED.some((p) => loc.pathname.startsWith(p))) {
    return <Navigate to="/financeiro?expirado=1" replace />;
  }
  return <AppShell />;
}

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route path="/criar-conta" element={<Signup />} />
        <Route path="/esqueci-senha" element={<Forgot />} />
        <Route path="/redefinir-senha" element={<Reset />} />
        <Route path="/verificar-email" element={<VerifyEmail />} />
        <Route path="/convite" element={<Invite />} />
        <Route element={<Protected />}>
          <Route index element={<Dashboard />} />
          <Route path="campanhas" element={<Campaigns />} />
          <Route path="vendas" element={<Sales />} />
          <Route path="vendas/:id" element={<SaleDetail />} />
          <Route path="eventos" element={<Events />} />
          <Route path="atribuicao" element={<Attribution />} />
          <Route path="diagnostico" element={<Diagnostics />} />
          <Route path="pixels" element={<Pixels />} />
          <Route path="integracoes" element={<Integrations />} />
          <Route path="integracoes/meta" element={<MetaAds />} />
          <Route path="configuracoes" element={<Settings />} />
          <Route path="financeiro" element={<Billing />} />
          <Route path="admin" element={<Admin />} />
          <Route path="ajuda" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
