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

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · PayTracking`; }, [title]);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0d0b1a] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#6d4aff]/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-2.5"><img src="/favicon.svg" alt="" className="h-9 w-9" /><span className="text-lg font-semibold">PayTracking</span></div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Cada venda confirmada, atribuída e entregue à Meta — sem duplicidade.</h2>
          <ul className="mt-8 space-y-4 text-[15px] text-white/75">
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />Purchase só com pagamento aprovado pelo gateway.</li>
            <li className="flex gap-3"><Zap className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />Pixel + Conversions API deduplicados pelo mesmo event_id.</li>
            <li className="flex gap-3"><LineChart className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />Receita, investimento e ROAS reais, em uma moeda só.</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Dados protegidos com criptografia em trânsito e em repouso.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden"><img src="/favicon.svg" alt="PayTracking" className="h-10 w-10" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
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
        <Button type="submit" variant="primary" className="w-full" loading={f.formState.isSubmitting}>Entrar</Button>
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
        <Button type="submit" variant="primary" className="w-full" loading={f.formState.isSubmitting}>Criar conta</Button>
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
          <Button type="submit" variant="primary" className="w-full" loading={f.formState.isSubmitting}>Enviar link</Button>
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
        <Button type="submit" variant="primary" className="w-full" loading={f.formState.isSubmitting}>Salvar nova senha</Button>
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
