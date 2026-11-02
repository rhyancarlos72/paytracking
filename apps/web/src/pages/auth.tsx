import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, CheckCircle2, Eye, EyeOff, KeyRound, LineChart, Lock, Mail, ShieldCheck, Zap } from 'lucide-react';
import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Callout, Field, Input, Spinner } from '../components/ui';
import { Logo } from '../components/logo';
import { get, post } from '../lib/api';
import { useMe } from '../lib/session';
import { platformPixelLoaded, storedUtms, usePlatformPixel } from '../lib/platform-pixel';

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
          <Zap className="h-3.5 w-3.5 text-blue-300" />Purchase entregue à Meta em 0,8 s
        </div>
      </div>
      <div className="absolute right-0 top-28 w-[250px] animate-float rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl [animation-delay:-2s]">
        <p className="text-xs text-white/60">Receita confirmada · 30 dias</p>
        <p className="mt-1 text-xl font-semibold text-white">R$ 48.920</p>
        <svg viewBox="0 0 200 50" className="mt-2 h-12 w-full">
          <defs><linearGradient id="authg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity=".45" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient></defs>
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
        <div className="pointer-events-none absolute -left-32 -top-32 h-[480px] w-[480px] animate-drift rounded-full bg-[#2563eb]/35 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -right-20 h-[420px] w-[420px] animate-drift rounded-full bg-cyan-400/15 blur-[120px] [animation-delay:-7s]" aria-hidden />
        <div className="grid-fade opacity-60 [--fg:255_255_255]" aria-hidden />
        <Link to="/conheca" className="relative flex w-fit items-center gap-2.5">
          <Logo onDark glow markClassName="h-10 w-10" textClassName="text-[21px]" />
        </Link>
        <div className="relative">
          <h2 className="max-w-lg text-[38px] font-semibold leading-[1.1] tracking-tight">
            Cada venda confirmada, <span className="bg-gradient-to-r from-blue-300 via-sky-200 to-cyan-200 bg-clip-text text-transparent">atribuída e entregue à Meta.</span>
          </h2>
          <ul className="mt-7 grid max-w-lg gap-3 text-[15px] text-white/75">
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />Purchase só com pagamento aprovado pelo gateway.</li>
            <li className="flex gap-3"><Zap className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />Pixel + Conversions API sem duplicidade.</li>
            <li className="flex gap-3"><LineChart className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />Receita, investimento e ROAS reais, em uma moeda só.</li>
          </ul>
          <PreviewCards />
        </div>
        <p className="relative text-xs text-white/60">Dados protegidos com criptografia em trânsito e em repouso.</p>
      </aside>
      <main className="relative flex items-center justify-center overflow-hidden px-4 py-12 sm:px-8">
        <div className="aurora" aria-hidden />
        <div className="w-full max-w-[420px] animate-slide-up">
          <Link to="/conheca" className="mb-10 flex w-fit items-center gap-2.5 lg:hidden">
            <Logo markClassName="h-10 w-10" textClassName="text-[21px]" />
          </Link>
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
    const back = sp.get('voltar');
    const dest = back && back.startsWith('/') && !back.startsWith('//') ? back : '/';
    // o pixel da plataforma (páginas públicas) não pode seguir para dentro do painel: recarrega limpo
    if (platformPixelLoaded()) { location.replace(dest); return; }
    await qc.invalidateQueries({ queryKey: ['me'] });
    nav(dest, { replace: true });
  };
}

/** 2º passo do login: código de 6 dígitos do app autenticador (ou um código de recuperação). */
function TwoFactorStep({ challenge, onDone, onRestart }: { challenge: string; onDone: () => Promise<void>; onRestart: () => void }) {
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = mode === 'code' ? /^\d{6}$/.test(value) : value.replace(/[^a-z0-9]/gi, '').length === 8;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      await post('/v1/auth/login/2fa', mode === 'code' ? { challenge, code: value } : { challenge, recoveryCode: value });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setValue('');
      if (/expirou/.test((e as Error).message)) setTimeout(onRestart, 2500);
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Verificação em duas etapas" subtitle={mode === 'code' ? 'Abra o app autenticador no celular e digite o código de 6 dígitos.' : 'Digite um dos códigos de recuperação que você guardou.'}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {error && <Callout tone="err" title={error} />}
        {mode === 'code' ? (
          <Field label="Código do app" htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000"
              className="text-center font-mono text-2xl tracking-[0.5em]" value={value}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setValue(v); }} />
          </Field>
        ) : (
          <Field label="Código de recuperação" htmlFor="rc">
            <Input id="rc" autoComplete="off" autoFocus maxLength={12} placeholder="xxxx-xxxx" className="text-center font-mono text-lg tracking-widest"
              value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!valid}>Confirmar e entrar</Button>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setMode(mode === 'code' ? 'recovery' : 'code'); setValue(''); setError(null); }}>
          {mode === 'code' ? 'Usar um código de recuperação' : 'Usar o código do app'}
        </button>
        <button type="button" className="text-muted hover:underline" onClick={onRestart}>Voltar</button>
      </div>
    </AuthLayout>
  );
}

/* ---------- peças compartilhadas das telas de acesso ---------- */

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelado: 'Login com Google cancelado.',
  google_expirou: 'O login com Google demorou demais ou foi aberto em outra aba. Tente de novo.',
  google_falhou: 'Não foi possível entrar com o Google agora. Tente de novo.',
  google_email_nao_verificado: 'Esse e-mail ainda não foi verificado pelo Google.',
  google_outra_conta: 'Este e-mail já está ligado a outra conta Google. Entre com e-mail e senha.',
  google_desativado: 'O login com Google não está disponível.',
};

function useProviders() {
  return useQuery({ queryKey: ['auth-providers'], queryFn: () => get<{ google: boolean }>('/v1/auth/providers'), staleTime: 300_000, retry: false });
}

function GoogleButton({ label }: { label: string }) {
  const [sp] = useSearchParams();
  const providers = useProviders();
  const [busy, setBusy] = useState(false);
  if (!providers.data?.google) return null;
  const back = sp.get('voltar');
  const href = `/v1/auth/google/start${back && back.startsWith('/') && !back.startsWith('//') ? `?voltar=${encodeURIComponent(back)}` : ''}`;
  return (
    <>
      <a href={href} onClick={() => setBusy(true)} aria-busy={busy}
        className="group flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface text-[15px] font-semibold shadow-sm transition hover:-translate-y-px hover:border-border-strong hover:shadow-md active:translate-y-0">
        {busy ? <Spinner /> : (
          <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
        )}
        {label}
      </a>
      <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-subtle" aria-hidden>
        <span className="h-px flex-1 bg-border" />ou com e-mail<span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

/** Campo de senha com botão de mostrar/ocultar. */
const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={show ? 'text' : 'password'} className="pr-11" />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted transition hover:text-fg">
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
});

const RULES: Array<[string, (v: string) => boolean]> = [
  ['10+ caracteres', (v) => v.length >= 10],
  ['Letra maiúscula', (v) => /[A-Z]/.test(v)],
  ['Letra minúscula', (v) => /[a-z]/.test(v)],
  ['Número', (v) => /\d/.test(v)],
];

/** Força da senha ao vivo: barra + checklist (as mesmas regras do servidor). */
function PasswordStrength({ value }: { value: string }) {
  const passed = RULES.filter(([, ok]) => ok(value)).length;
  const bonus = value.length >= 14 && /[^A-Za-z0-9]/.test(value) ? 1 : 0;
  const score = value ? Math.min(5, passed + bonus) : 0;
  const label = ['', 'Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Excelente'][score];
  const color = score <= 2 ? 'bg-err' : score === 3 ? 'bg-warn' : 'bg-ok';
  return (
    <div className="mt-2.5" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={clsx('h-1.5 flex-1 rounded-full transition-colors duration-300', i < score ? color : 'bg-surface-3')} />)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {RULES.map(([name, ok]) => (
          <span key={name} className={clsx('inline-flex items-center gap-1 transition-colors', ok(value) ? 'text-ok' : 'text-subtle')}>
            {ok(value) ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}{name}
          </span>
        ))}
        {label && <span className="ml-auto font-semibold text-muted">{label}</span>}
      </div>
    </div>
  );
}

function IconBadge({ children, tone = 'primary' }: { children: ReactNode; tone?: 'primary' | 'ok' }) {
  return (
    <div className="relative mb-6 inline-flex">
      <span className={clsx('absolute inset-0 rounded-2xl blur-xl', tone === 'ok' ? 'bg-ok/30' : 'bg-primary/30')} aria-hidden />
      <span className={clsx('relative flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg',
        tone === 'ok' ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-[#60a5fa] to-[#5b3df5]')}>
        {children}
      </span>
    </div>
  );
}

/* ---------- telas ---------- */

export function LoginPage() {
  const after = useAfterAuth();
  const { data: me } = useMe();
  const [sp] = useSearchParams();
  const [error, setError] = useState<string | null>(() => GOOGLE_ERRORS[sp.get('erro') ?? ''] ?? null);
  // 2FA vindo do login com Google: o desafio chega no fragmento (#desafio=...)
  const [challenge, setChallenge] = useState<string | null>(() => {
    const m = /(?:^#|&)desafio=([^&]+)/.exec(window.location.hash);
    if (m) history.replaceState(null, '', window.location.pathname + window.location.search);
    return m ? decodeURIComponent(m[1]!) : null;
  });
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email('E-mail inválido'), password: z.string().min(1, 'Informe a senha') })) });
  useEffect(() => { if (me) void after(); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  if (challenge) return <TwoFactorStep challenge={challenge} onDone={after} onRestart={() => setChallenge(null)} />;
  return (
    <AuthLayout title="Bem-vindo de volta" subtitle="Acesse o painel da sua operação.">
      <GoogleButton label="Entrar com Google" />
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
        setError(null);
        try {
          const r = await post<{ ok: boolean; twoFactorRequired?: boolean; challenge?: string }>('/v1/auth/login', v);
          if (r.twoFactorRequired && r.challenge) setChallenge(r.challenge); else await after();
        } catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} />}
        <Field label="E-mail" htmlFor="email" error={f.formState.errors.email?.message as string}>
          <Input id="email" type="email" autoComplete="email" autoFocus placeholder="voce@empresa.com" {...f.register('email')} />
        </Field>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">Senha</label>
            <Link to="/esqueci-senha" className="text-sm font-medium text-primary hover:underline">Esqueci a senha</Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" {...f.register('password')} />
          {f.formState.errors.password && <p className="mt-1.5 text-xs font-medium text-err" role="alert">{String(f.formState.errors.password.message)}</p>}
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Entrar</Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">Ainda não tem conta? <Link to="/criar-conta" className="font-semibold text-primary hover:underline">Comece o teste grátis</Link></p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const after = useAfterAuth();
  usePlatformPixel();
  const [error, setError] = useState<string | null>(null);
  const [withOrg, setWithOrg] = useState(false);
  const schema = z.object({
    name: z.string().trim().min(2, 'Informe seu nome').max(120),
    orgName: z.string().trim().max(120).optional(),
    email: z.string().email('E-mail inválido'),
    password,
    confirm: z.string(),
  }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem' });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const err = f.formState.errors;
  const pw = f.watch('password') ?? '';
  return (
    <AuthLayout title="Crie sua conta" subtitle="Comece a medir suas vendas reais em minutos.">
      <ul className="-mt-2 mb-7 flex flex-wrap gap-2 text-xs font-medium">
        {['7 dias grátis', 'Sem cartão de crédito', 'Cancele quando quiser'].map((t) => (
          <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-3 py-1 text-primary ring-1 ring-inset ring-primary/20">
            <Check className="h-3.5 w-3.5" aria-hidden />{t}
          </li>
        ))}
      </ul>
      <GoogleButton label="Criar conta com Google" />
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async ({ confirm: _c, ...v }) => {
        setError(null);
        try { await post('/v1/auth/signup', { ...v, utms: storedUtms() }); await after(); } catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} />}
        <Field label="Seu nome" htmlFor="name" error={err.name?.message}><Input id="name" autoComplete="name" placeholder="Como devemos te chamar" {...f.register('name')} /></Field>
        <Field label="E-mail" htmlFor="email" error={err.email?.message}><Input id="email" type="email" autoComplete="email" placeholder="voce@empresa.com" {...f.register('email')} /></Field>
        {withOrg ? (
          <Field label="Empresa" htmlFor="org" hint="Nome da organização no painel."><Input id="org" autoComplete="organization" autoFocus {...f.register('orgName')} /></Field>
        ) : (
          <button type="button" onClick={() => setWithOrg(true)} className="text-sm font-medium text-primary hover:underline">+ Adicionar nome da empresa</button>
        )}
        <div>
          <label className="label" htmlFor="pw">Senha</label>
          <PasswordInput id="pw" autoComplete="new-password" {...f.register('password')} />
          <PasswordStrength value={pw} />
          {err.password && <p className="mt-1.5 text-xs font-medium text-err" role="alert">{err.password.message}</p>}
        </div>
        <Field label="Confirmar senha" htmlFor="pw2" error={err.confirm?.message}><PasswordInput id="pw2" autoComplete="new-password" {...f.register('confirm')} /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Criar minha conta</Button>
        <p className="text-center text-xs text-subtle"><Lock className="mr-1 inline h-3 w-3" aria-hidden />Ao criar a conta você concorda com os <a href="/termos" className="underline hover:text-fg">Termos de Uso</a> e a <a href="/privacidade" className="underline hover:text-fg">Política de Privacidade</a>.</p>
      </form>
      <p className="mt-8 text-center text-sm text-muted">Já tem conta? <Link to="/entrar" className="font-semibold text-primary hover:underline">Entrar</Link></p>
    </AuthLayout>
  );
}

const WEBMAIL: Array<[RegExp, string, string]> = [
  [/@(gmail|googlemail)\./i, 'Abrir o Gmail', 'https://mail.google.com/mail/u/0/#search/PayTracking'],
  [/@(outlook|hotmail|live|msn)\./i, 'Abrir o Outlook', 'https://outlook.live.com/mail/0/'],
  [/@(yahoo|ymail)\./i, 'Abrir o Yahoo Mail', 'https://mail.yahoo.com/'],
  [/@(icloud|me|mac)\./i, 'Abrir o iCloud Mail', 'https://www.icloud.com/mail'],
];

export function ForgotPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email('E-mail inválido') })) });
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const request = async (email: string) => {
    await post('/v1/auth/forgot-password', { email }).catch(() => undefined);
    setSentTo(email);
    setCooldown(60);
  };
  if (sentTo) {
    const webmail = WEBMAIL.find(([re]) => re.test(sentTo));
    return (
      <AuthLayout title="Confira seu e-mail" subtitle={<>Se existir uma conta com <b className="text-fg">{sentTo}</b>, o link para criar uma nova senha chega em instantes.</>}>
        <div className="-mt-2 space-y-5">
          <ol className="space-y-3 rounded-2xl border border-border bg-surface p-5 text-sm">
            {['Abra o e-mail “Redefinição de senha — PayTracking”.', 'Toque em “Abrir no PayTracking”.', 'Crie a nova senha. O link vale por 1 hora.'].map((t, i) => (
              <li key={t} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span><span className="pt-0.5">{t}</span></li>
            ))}
          </ol>
          {webmail && <a href={webmail[2]} target="_blank" rel="noreferrer noopener" className="block"><Button variant="primary" size="lg" className="w-full"><Mail className="h-4 w-4" aria-hidden />{webmail[1]}</Button></a>}
          <p className="text-center text-sm text-muted">
            Não chegou? Veja a caixa de spam ou{' '}
            {cooldown > 0
              ? <span>reenvie em {cooldown}s</span>
              : <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void request(sentTo)}>reenvie o link</button>}.
          </p>
          <p className="text-center text-sm"><button type="button" className="text-muted hover:underline" onClick={() => setSentTo(null)}>Usar outro e-mail</button></p>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Esqueceu a senha?" subtitle="Sem problema. Digite seu e-mail e enviaremos um link seguro para criar uma nova.">
      <IconBadge><KeyRound className="h-6 w-6" aria-hidden /></IconBadge>
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit((v) => request(String(v.email).trim()))}>
        <Field label="E-mail da conta" htmlFor="email" error={f.formState.errors.email?.message as string}>
          <Input id="email" type="email" autoComplete="email" autoFocus placeholder="voce@empresa.com" {...f.register('email')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.formState.isSubmitting}>Enviar link de recuperação</Button>
      </form>
      <p className="mt-8 text-center text-sm"><Link to="/entrar" className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden />Voltar para o login</Link></p>
    </AuthLayout>
  );
}

export function ResetPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const token = sp.get('token');
  const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem' });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const pw = f.watch('password') ?? '';
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => nav('/entrar', { replace: true }), 4000);
    return () => clearTimeout(t);
  }, [done, nav]);
  if (!token) {
    return (
      <AuthLayout title="Link incompleto" subtitle="Abra o link direto do e-mail, sem cortar o endereço.">
        <Link to="/esqueci-senha"><Button variant="primary" size="lg" className="w-full">Pedir um novo link</Button></Link>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Senha atualizada!" subtitle="Tudo certo. Por segurança, encerramos as sessões que estavam abertas.">
        <IconBadge tone="ok"><Check className="h-7 w-7" aria-hidden /></IconBadge>
        <Link to="/entrar" replace><Button variant="primary" size="lg" className="w-full">Entrar com a nova senha</Button></Link>
        <p className="mt-4 text-center text-xs text-subtle">Redirecionando em instantes…</p>
      </AuthLayout>
    );
  }
  const expired = !!error && /inválido|expirado/i.test(error);
  return (
    <AuthLayout title="Crie uma nova senha" subtitle="Escolha uma senha forte que você não use em outros sites.">
      <IconBadge><ShieldCheck className="h-6 w-6" aria-hidden /></IconBadge>
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
        setError(null);
        try { await post('/v1/auth/reset-password', { token, password: v.password }); setDone(true); }
        catch (e) { setError((e as Error).message); }
      })}>
        {error && <Callout tone="err" title={error} action={expired ? <Link to="/esqueci-senha" className="text-sm font-semibold underline">Pedir novo link</Link> : undefined} />}
        <div>
          <label className="label" htmlFor="pw">Nova senha</label>
          <PasswordInput id="pw" autoComplete="new-password" autoFocus {...f.register('password')} />
          <PasswordStrength value={pw} />
        </div>
        <Field label="Confirmar nova senha" htmlFor="pw2" error={f.formState.errors.confirm?.message}><PasswordInput id="pw2" autoComplete="new-password" {...f.register('confirm')} /></Field>
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
