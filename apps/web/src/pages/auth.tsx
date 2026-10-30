import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Zap, LineChart } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Callout, Field, Input, Spinner } from '../components/ui';
import { post } from '../lib/api';
import { useMe } from '../lib/session';

const password = z.string().min(10, 'Mínimo de 10 caracteres').max(200)
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula').regex(/[a-z]/, 'Inclua uma letra minúscula').regex(/\d/, 'Inclua um número');

function PreviewCards() {
  // composição ilustrativa do produto (decorativa: aria-hidden, valores de exemplo)
  return (
    <div className="relative mx-auto mt-12 h-[300px] w-full max-w-[440px]" aria-hidden>
      <div className="absolute left-0 top-4 w-[300px] animate-float rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Venda aprovada</p>
            <p className="text-xs text-white/60">Checkout próprio · PIX</p>
          </div>
          <p className="text-sm font-semibold text-white">R$ 197,00</p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-white/75">
          <Zap className="h-3.5 w-3.5 text-violet-300" />Purchase entregue à Meta em 0,8 s
        </div>
      </div>
      <div className="absolute right-0 top-28 w-[250px] animate-float rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl [animation-delay:-2s]">
        <p className="text-xs text-white/60">Receita confirmada · 30 dias</p>
        <p className="mt-1 text-xl font-semibold text-white">R$ 48.920</p>
        <svg viewBox="0 0 200 50" className="mt-2 h-12 w-full">
          <defs><linearGradient id="authg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8b70ff" stopOpacity=".45" /><stop offset="100%" stopColor="#8b70ff" stopOpacity="0" /></linearGradient></defs>
          <path d="M0,42 C20,40 30,30 50,32 C70,34 80,20 100,22 C120,24 130,12 150,14 C170,16 180,6 200,4 L200,50 L0,50 Z" fill="url(#authg)" />
          <path d="M0,42 C20,40 30,30 50,32 C70,34 80,20 100,22 C120,24 130,12 150,14 C170,16 180,6 200,4" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-10 animate-float rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs text-white/80 shadow-xl backdrop-blur-xl [animation-delay:-4s]">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400" />Pixel + CAPI deduplicados pelo mesmo event_id
      </div>
    </div>
  );
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · PayTracking`; }, [title]);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#07060f] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[480px] w-[480px] animate-drift rounded-full bg-[#6d4aff]/35 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -right-20 h-[420px] w-[420px] animate-drift rounded-full bg-cyan-400/15 blur-[120px] [animation-delay:-7s]" aria-hidden />
        <div className="grid-fade opacity-60 [--fg:255_255_255]" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="relative"><span className="absolute inset-0 rounded-xl bg-violet-500/50 blur-md" aria-hidden /><img src="/favicon.svg" alt="" className="relative h-9 w-9" /></span>
          <span className="text-lg font-semibold">PayTracking</span>
        </div>
        <div className="relative">
          <h2 className="max-w-lg text-[38px] font-semibold leading-[1.1] tracking-tight">
            Cada venda confirmada, <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">atribuída e entregue à Meta.</span>
          </h2>
          <ul className="mt-7 grid max-w-lg gap-3 text-[15px] text-white/75">
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />Purchase só com pagamento aprovado pelo gateway.</li>
            <li className="flex gap-3"><Zap className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />Pixel + Conversions API sem duplicidade.</li>
            <li className="flex gap-3"><LineChart className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />Receita, investimento e ROAS reais, em uma moeda só.</li>
          </ul>
          <PreviewCards />
        </div>
        <p className="relative text-xs text-white/60">Dados protegidos com criptografia em trânsito e em repouso.</p>
      </aside>
      <main className="relative flex items-center justify-center overflow-hidden px-4 py-12 sm:px-8">
        <div className="aurora" aria-hidden />
        <div className="w-full max-w-[420px] animate-slide-up">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <img src="/favicon.svg" alt="" className="h-10 w-10" /><span className="text-lg font-semibold">PayTracking</span>
          </div>
          <h1 className="text-[30px] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

function useAfterAuth() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    const back = sp.get('voltar');
    nav(back && back.startsWith('/') && !back.startsWith('//') ? back : '/', { replace: true });
  };
}

export function LoginPage() {
  const after = useAfterAuth();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email('E-mail inválido'), password: z.string().min(1, 'Informe a senha') })) });
  useEffect(() => { if (me) void after(); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthLayout title="Entrar" subtitle="Acesse o painel da sua operação.">
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
        setError(null);
        try { await post('/v1/auth/login', v); await after(); } catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} />}
        <Field label="E-mail" htmlFor="email" error={f.formState.errors.email?.message as string}>
          <Input id="email" type="email" autoComplete="email" autoFocus {...f.register('email')} />
        </Field>
        <Field label="Senha" htmlFor="password" error={f.formState.errors.password?.message as string}>
          <Input id="password" type="password" autoComplete="current-password" {...f.register('password')} />
        </Field>
        <div className="flex justify-end"><Link to="/esqueci-senha" className="text-sm font-medium text-primary hover:underline">Esqueci a senha</Link></div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Entrar</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Ainda não tem conta? <Link to="/criar-conta" className="font-medium text-primary hover:underline">Comece o teste grátis</Link></p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const after = useAfterAuth();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({
    name: z.string().trim().min(2, 'Informe seu nome').max(120),
    orgName: z.string().trim().max(120).optional(),
    email: z.string().email('E-mail inválido'),
    password,
    confirm: z.string(),
  }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem' });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const err = f.formState.errors;
  return (
    <AuthLayout title="Criar conta" subtitle="7 dias grátis, sem cartão. Depois, R$ 47/mês.">
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async ({ confirm: _c, ...v }) => {
        setError(null);
        try { await post('/v1/auth/signup', v); await after(); } catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} />}
        <Field label="Seu nome" htmlFor="name" error={err.name?.message}><Input id="name" autoComplete="name" {...f.register('name')} /></Field>
        <Field label="Empresa (opcional)" htmlFor="org" hint="Nome da organização no painel."><Input id="org" autoComplete="organization" {...f.register('orgName')} /></Field>
        <Field label="E-mail" htmlFor="email" error={err.email?.message}><Input id="email" type="email" autoComplete="email" {...f.register('email')} /></Field>
        <Field label="Senha" htmlFor="pw" error={err.password?.message} hint="Mínimo de 10 caracteres, com maiúscula, minúscula e número.">
          <Input id="pw" type="password" autoComplete="new-password" {...f.register('password')} />
        </Field>
        <Field label="Confirmar senha" htmlFor="pw2" error={err.confirm?.message}><Input id="pw2" type="password" autoComplete="new-password" {...f.register('confirm')} /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Criar conta</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Já tem conta? <Link to="/entrar" className="font-medium text-primary hover:underline">Entrar</Link></p>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [sent, setSent] = useState(false);
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email('E-mail inválido') })) });
  return (
    <AuthLayout title="Recuperar acesso" subtitle="Enviaremos um link para criar uma nova senha.">
      {sent ? (
        <Callout tone="ok" title="Verifique seu e-mail">Se houver uma conta com esse endereço, você receberá o link em instantes. Ele expira em 1 hora.</Callout>
      ) : (
        <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => { await post('/v1/auth/forgot-password', v).catch(() => undefined); setSent(true); })}>
          <Field label="E-mail" htmlFor="email" error={f.formState.errors.email?.message as string}><Input id="email" type="email" autoFocus {...f.register('email')} /></Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Enviar link</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/entrar" className="font-medium text-primary hover:underline">Voltar para o login</Link></p>
    </AuthLayout>
  );
}

export function ResetPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem' });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout title="Nova senha" subtitle="Por segurança, todas as sessões abertas serão encerradas.">
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
        setError(null);
        try { await post('/v1/auth/reset-password', { token: sp.get('token'), password: v.password }); nav('/entrar', { replace: true }); }
        catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} />}
        <Field label="Nova senha" htmlFor="pw" error={f.formState.errors.password?.message}><Input id="pw" type="password" autoComplete="new-password" {...f.register('password')} /></Field>
        <Field label="Confirmar" htmlFor="pw2" error={f.formState.errors.confirm?.message}><Input id="pw2" type="password" autoComplete="new-password" {...f.register('confirm')} /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Salvar nova senha</Button>
      </form>
    </AuthLayout>
  );
}

function TokenAction({ title, path, success, cta }: { title: string; path: string; success: string; cta: { to: string; label: string } }) {
  const [sp] = useSearchParams();
  const [state, setState] = useState<'loading' | 'ok' | string>('loading');
  const qc = useQueryClient();
  useEffect(() => {
    post(path, { token: sp.get('token') })
      .then(() => { setState('ok'); void qc.invalidateQueries({ queryKey: ['me'] }); })
      .catch((e) => setState((e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthLayout title={title}>
      {state === 'loading' ? <Spinner /> : state === 'ok'
        ? <div className="space-y-4"><Callout tone="ok" title={success} /><Link to={cta.to}><Button variant="primary" className="w-full" icon={<CheckCircle2 className="h-4 w-4" />}>{cta.label}</Button></Link></div>
        : <Callout tone="err" title={state} />}
    </AuthLayout>
  );
}

export const VerifyEmailPage = () => <TokenAction title="Confirmação de e-mail" path="/v1/auth/verify-email" success="E-mail confirmado." cta={{ to: '/', label: 'Ir para o painel' }} />;

export function InvitePage() {
  const { data: me, isLoading } = useMe();
  const [sp] = useSearchParams();
  if (isLoading) return <AuthLayout title="Convite"><Spinner /></AuthLayout>;
  if (!me) {
    const back = encodeURIComponent(`/convite?token=${sp.get('token') ?? ''}`);
    return (
      <AuthLayout title="Você recebeu um convite" subtitle="Entre ou crie sua conta com o e-mail convidado para aceitar.">
        <div className="space-y-3">
          <Link to={`/entrar?voltar=${back}`}><Button variant="primary" className="w-full">Entrar</Button></Link>
          <Link to={`/criar-conta?voltar=${back}`}><Button className="mt-3 w-full">Criar conta</Button></Link>
        </div>
      </AuthLayout>
    );
  }
  return <TokenAction title="Convite" path="/v1/invitations/accept" success="Convite aceito. Você já faz parte da organização." cta={{ to: '/', label: 'Abrir o painel' }} />;
}
