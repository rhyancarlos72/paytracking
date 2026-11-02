import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BadgeCheck, Bell, Calculator, CalendarClock, Check, CircleDollarSign, Clock, Code2, Copy, Eye, Infinity as InfinityIcon,
  Crown, KeyRound, Layers, LineChart, Lock, MousePointerClick, Plug, QrCode, Receipt, Repeat, ShieldCheck, Smartphone, Sparkles,
  Target, Trophy, Users, Volume2, Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from '../components/logo';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, ErrorState, Input, Modal, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useSession } from '../lib/session';

interface Charge { id: string; status: 'pending' | 'paid' | 'expired'; amount_minor: string; created_at: string; paid_at: string | null; expires_at: string; br_code: string | null; qr_code_image: string | null; payment_link_url: string | null }
interface Billing {
  plan: { status: 'trial' | 'active' | 'expired' | 'exempt'; daysLeft: number | null; blocked: boolean; expiresAt: string | null; priceMinor: number; currency: string };
  charges: Charge[]; wooviConfigured: boolean;
}

const STATUS: Record<Billing['plan']['status'], { label: string; tone: string; dot: string }> = {
  trial: { label: 'Teste grátis', tone: 'bg-blue-400/15 text-blue-200 ring-blue-300/30', dot: 'bg-blue-300' },
  active: { label: 'Assinatura ativa', tone: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30', dot: 'bg-emerald-300' },
  expired: { label: 'Assinatura expirada', tone: 'bg-rose-400/15 text-rose-200 ring-rose-300/30', dot: 'bg-rose-300' },
  exempt: { label: 'Isento', tone: 'bg-sky-400/15 text-sky-200 ring-sky-300/30', dot: 'bg-sky-300' },
};

/* Tudo o que a assinatura inclui (somente recursos que existem no produto). */
const GROUPS: Array<{ title: string; icon: ReactNode; tone: string; items: Array<{ icon: ReactNode; t: string; d: string }> }> = [
  {
    title: 'Rastreamento que a Meta entende', icon: <Target />, tone: 'from-blue-500 to-sky-500',
    items: [
      { icon: <BadgeCheck />, t: 'Purchase só com pagamento aprovado', d: 'PIX gerado não vira venda. Reembolso e chargeback registrados.' },
      { icon: <Layers />, t: 'Pixel + Conversions API sem duplicar', d: 'Mesmo event_id no navegador e no servidor.' },
      { icon: <MousePointerClick />, t: 'UTMs e clique preservados até o checkout', d: 'Campanha, conjunto e anúncio chegam com a venda, inclusive na Hotmart.' },
      { icon: <Zap />, t: 'Fila com reenvio automático', d: 'Se a Meta oscilar, o evento é reenviado sozinho, sem duplicar.' },
    ],
  },
  {
    title: 'Integrações', icon: <Plug />, tone: 'from-sky-500 to-cyan-400',
    items: [
      { icon: <Plug />, t: 'Hotmart, Kiwify, Kirvano e Cakto', d: 'URL de webhook exclusiva por integração.' },
      { icon: <Code2 />, t: 'Checkout próprio (PHP)', d: 'Arquivo pronto, envio assinado com HMAC.' },
      { icon: <Repeat />, t: 'Modo sombra para migrar', d: 'Registra tudo sem enviar à Meta até você desligar o sistema antigo.' },
      { icon: <InfinityIcon />, t: 'Pixels e integrações ilimitados', d: 'Quantos produtos e pixels você precisar.' },
    ],
  },
  {
    title: 'Análise e decisão', icon: <LineChart />, tone: 'from-emerald-500 to-teal-400',
    items: [
      { icon: <CircleDollarSign />, t: 'ROAS real por campanha e conjunto', d: 'Gasto da Meta lado a lado com a venda confirmada.' },
      { icon: <Trophy />, t: 'Ranking das campanhas que mais vendem', d: 'Destaques: melhor ROAS, mais vendas e gasto sem venda.' },
      { icon: <Target />, t: 'Atribuição por UTM e metas', d: 'Funil, metas diária e mensal, moedas convertidas pela cotação do dia.' },
      { icon: <Receipt />, t: 'Controle da Meta no painel', d: 'Pausar, ativar, duplicar e editar orçamento sem abrir o Gerenciador.' },
    ],
  },
  {
    title: 'Alertas, equipe e segurança', icon: <ShieldCheck />, tone: 'from-amber-500 to-orange-400',
    items: [
      { icon: <Smartphone />, t: 'Venda no celular, na hora', d: 'Notificação push a cada venda aprovada.' },
      { icon: <Volume2 />, t: 'Som de venda', d: 'Escolha um som ou envie o seu.' },
      { icon: <Users />, t: 'Equipe com permissões', d: 'Proprietário, admin, analista e leitura.' },
      { icon: <Eye />, t: 'Modo privado e 2FA', d: 'Esconda nomes para prints; verificação em duas etapas e login com Google.' },
    ],
  },
];

function useCountdown(to: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!to) return null;
  const ms = Math.max(0, new Date(to).getTime() - now);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function BillingPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery<Billing>({ queryKey: ['billing'], queryFn: () => get('/v1/billing') });
  const trial = useQuery({ queryKey: ['public-plan'], queryFn: () => get<{ trialDays: number }>('/v1/public/plan'), staleTime: 300_000 });
  const pending = q.data?.charges?.find((c) => c.status === 'pending' && new Date(c.expires_at) > new Date());
  const countdown = useCountdown(pending?.expires_at);
  // aguarda a confirmação do PIX (webhook da Woovi) enquanto houver cobrança aberta
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      const r = await get<Billing>('/v1/billing');
      if (r.charges.find((c) => c.id === pending.id)?.status === 'paid') {
        toast.ok('Pagamento confirmado! 🎉', 'Sua assinatura foi renovada por 30 dias.');
        void qc.invalidateQueries();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const charge = useMutation({ mutationFn: () => post('/v1/billing/charge'), onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }), onError: (e) => toast.err(e) });
  // popup de assinatura vencida: aparece ao chegar aqui com o painel bloqueado (sem PIX em aberto)
  const [expiredPopup, setExpiredPopup] = useState(true);
  // veio do aviso "Pagar com PIX": já gera o PIX (uma vez) em vez de mostrar outro popup
  const autoPay = useRef(new URLSearchParams(location.search).get('pagar') === '1');
  useEffect(() => {
    const d = q.data;
    if (!autoPay.current || !d || pending || charge.isPending) return;
    autoPay.current = false;
    history.replaceState(null, '', '/financeiro');
    if (d.plan.status !== 'exempt' && d.wooviConfigured && s.can('owner')) { setExpiredPopup(false); charge.mutate(); }
  }, [q.data, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isError) return <><PageHeader title="Financeiro" /><Card><ErrorState error={q.error} /></Card></>;
  if (!q.data) return <><PageHeader title="Financeiro" /><Skeleton className="h-72" /><Skeleton className="mt-6 h-96" /></>;

  const plan = q.data.plan;
  const st = STATUS[plan.status];
  const price = money(plan.priceMinor, 'BRL');
  const expired = plan.status === 'expired' || plan.blocked;
  const trialDays = trial.data?.trialDays ?? 7;
  const total = plan.status === 'trial' ? trialDays : 30;
  const left = plan.daysLeft ?? 0;
  const progress = plan.status === 'exempt' ? 1 : Math.max(0, Math.min(1, left / total));
  const owner = s.can('owner');
  const sinceDays = plan.expiresAt ? Math.max(0, Math.floor((Date.now() - new Date(plan.expiresAt).getTime()) / 86_400_000)) : 0;
  const cta = expired ? 'Reativar agora' : plan.status === 'trial' ? 'Assinar agora' : 'Renovar agora';

  return (
    <>
      <PageHeader title="Financeiro" eyebrow="Assinatura" description="Um plano, tudo incluído. Pagamento mensal por PIX, sem fidelidade e sem taxa por venda." />
      <Modal open={expired && !pending && expiredPopup && !s.user.isPlatformAdmin} onClose={() => setExpiredPopup(false)}
        title="Assinatura vencida"
        footer={<>
          <Button onClick={() => setExpiredPopup(false)}>Agora não</Button>
          {owner && q.data.wooviConfigured && (
            <Button variant="primary" icon={<QrCode className="h-4 w-4" />} loading={charge.isPending} onClick={() => { charge.mutate(); setExpiredPopup(false); }}>Pagar com PIX · {price}</Button>
          )}
        </>}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500 ring-1 ring-inset ring-amber-400/30 dark:text-amber-300"><Lock className="h-7 w-7" aria-hidden /></span>
          <p className="mt-4 text-lg font-semibold">Pague sua assinatura para liberar o acesso ao painel e às suas vendas.</p>
          <p className="mt-2 text-sm text-muted">Nada foi perdido: o rastreamento e o envio à Meta continuam guardados. Assim que o PIX de {price} for confirmado, tudo volta na hora, por mais 30 dias.</p>
          {!owner && <p className="mt-3 text-sm font-medium text-warn">Somente o proprietário da organização pode pagar. Avise o responsável pela conta.</p>}
          {owner && !q.data.wooviConfigured && <p className="mt-3 text-sm font-medium text-warn">O pagamento por PIX está indisponível no momento. Fale com o suporte.</p>}
        </div>
      </Modal>

      <div className="space-y-6">
        {/* ====== plano (herói) + pagamento ====== */}
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <section className="relative overflow-hidden rounded-[28px] bg-[#0b0820] p-6 text-white shadow-2xl ring-1 ring-white/10 sm:p-8" aria-label="Seu plano">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#2563eb]/45 blur-[110px]" aria-hidden />
            <div className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-cyan-400/15 blur-[110px]" aria-hidden />
            <div className="grid-fade opacity-40 [--fg:255_255_255]" aria-hidden />
            <LogoMark onDark className="pointer-events-none absolute -right-6 bottom-0 h-56 w-56 opacity-[0.07]" />

            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <span className={clsx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset', st.tone)}>
                <span className={clsx('h-1.5 w-1.5 rounded-full', st.dot, plan.status !== 'expired' && 'animate-pulse')} />{st.label}
              </span>
              <span className="text-xs text-white/50">PayTracking completo</span>
            </div>

            <div className="relative mt-6 flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-[54px] font-extrabold leading-none tracking-[-0.04em] sm:text-[64px]">{price}</span>
                  <span className="text-lg text-white/60">/mês</span>
                </p>
                <p className="mt-2 text-sm text-white/65">Vendas ilimitadas · zero taxa por venda · todos os recursos</p>
              </div>
              {plan.status !== 'exempt' && (
                <div className="min-w-[200px] flex-1 sm:max-w-[260px]">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-white/60">{expired ? 'Venceu' : plan.status === 'trial' ? 'Teste termina em' : 'Próximo vencimento'}</span>
                    <span className="font-semibold">{expired ? (sinceDays === 0 ? 'hoje' : `há ${sinceDays} dia${sinceDays === 1 ? '' : 's'}`) : `${left} dia${left === 1 ? '' : 's'}`}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={clsx('h-full rounded-full transition-[width] duration-700', expired ? 'bg-rose-400' : left <= 3 ? 'bg-amber-300' : 'bg-gradient-to-r from-[#60a5fa] to-[#22d3ee]')}
                      style={{ width: `${expired ? 100 : Math.max(4, progress * 100)}%` }} />
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/50"><CalendarClock className="h-3.5 w-3.5" />{dateTime(plan.expiresAt, s.org.timezone)}</p>
                </div>
              )}
            </div>

            {plan.status === 'exempt' && (
              <div className="relative mt-8 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-inset ring-white/10">
                <p className="flex items-center gap-2 text-sm font-semibold"><Crown className="h-4 w-4 text-amber-300" />{s.user.isPlatformAdmin ? 'Conta do dono da plataforma — isenta, sem cobrança' : 'Organização isenta de cobrança'}</p>
                <p className="mt-1 text-xs text-white/60">Por isso o botão de pagamento não aparece aqui. As contas dos seus clientes veem o botão “Assinar agora · PIX {price}” neste mesmo lugar{s.user.isPlatformAdmin ? ', e você pode isentar ou estender qualquer conta pelo painel Admin' : ''}.</p>
                {s.user.isPlatformAdmin && !q.data.wooviConfigured && <p className="mt-2 text-xs font-semibold text-amber-300">Atenção: WOOVI_APP_ID não está configurado no servidor — seus clientes ainda não conseguem gerar o PIX.</p>}
              </div>
            )}
            {plan.status !== 'exempt' && !pending && (
              <div className="relative mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                {q.data.wooviConfigured ? (
                  <button disabled={!owner || charge.isPending} onClick={() => charge.mutate()}
                    className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-7 text-[16px] font-semibold text-white shadow-[0_12px_34px_-10px_rgba(37,99,235,.9)] ring-1 ring-inset ring-white/15 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60">
                    {charge.isPending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <QrCode className="h-5 w-5" />}
                    <span className="whitespace-nowrap">{cta}</span><span className="whitespace-nowrap text-white/75">· PIX {price}</span>
                  </button>
                ) : (
                  <p className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100 ring-1 ring-inset ring-amber-300/25">
                    {s.user.isPlatformAdmin ? 'Pagamento desligado: defina WOOVI_APP_ID (e WOOVI_WEBHOOK_SECRET) nas variáveis de ambiente do servidor.' : 'Pagamento por PIX indisponível no momento. Fale com o suporte para renovar.'}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-xs text-white/55"><Lock className="h-3.5 w-3.5" />Sem cobrança automática: você paga só se quiser continuar.</p>
              </div>
            )}
            {!owner && <p className="relative mt-3 text-xs text-white/50">Somente o proprietário da organização pode gerar a cobrança.</p>}
            {plan.status !== 'exempt' && <p className="relative mt-5 text-xs text-white/45">Cada pagamento soma 30 dias a partir do vencimento atual: pagar antes nunca faz você perder dias.</p>}
          </section>

          {/* pagamento PIX / o que acontece */}
          {pending ? (
            <section className="card relative overflow-hidden p-6" aria-label="Pagamento PIX">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl" aria-hidden />
              <div className="relative flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold"><QrCode className="h-5 w-5 text-primary" />Pague com PIX</h2>
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-warn ring-1 ring-inset ring-warn/25">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-warn" /></span>
                  Aguardando pagamento
                </span>
              </div>
              <div className="relative mt-5 grid items-center gap-6 sm:grid-cols-[auto_1fr] xl:grid-cols-1 2xl:grid-cols-[auto_1fr]">
                {pending.qr_code_image && (
                  <div className="relative mx-auto">
                    <div className="absolute -inset-3 rounded-[28px] bg-gradient-to-tr from-[#2563eb]/40 to-emerald-400/30 blur-xl" aria-hidden />
                    <img src={pending.qr_code_image} alt="QR Code do PIX" className="relative h-52 w-52 rounded-2xl border border-border bg-white p-2.5 shadow-xl" />
                  </div>
                )}
                <div className="min-w-0 space-y-3">
                  <p className="text-center font-display text-2xl font-bold sm:text-left">{money(pending.amount_minor, 'BRL')}</p>
                  {pending.br_code && (
                    <button className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-3.5 py-3 text-left transition hover:border-primary/40"
                      onClick={async () => { await navigator.clipboard.writeText(pending.br_code!); toast.ok('Código PIX copiado', 'Cole no app do seu banco em PIX → Copia e cola.'); }}>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{pending.br_code}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white"><Copy className="h-3.5 w-3.5" />Copiar</span>
                    </button>
                  )}
                  <ol className="space-y-1.5 text-sm text-muted">
                    {['Abra o app do seu banco e escolha PIX.', 'Leia o QR code ou use “Copia e cola”.', 'Pronto: a liberação é automática em segundos.'].map((t, i) => (
                      <li key={t} className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>{t}</li>
                    ))}
                  </ol>
                  {countdown && <p className="flex items-center gap-1.5 text-xs text-muted"><Clock className="h-3.5 w-3.5" />Este PIX expira em <span className="num font-semibold text-fg">{countdown}</span></p>}
                </div>
              </div>
            </section>
          ) : (
            <section className="card relative overflow-hidden p-6" aria-label="O que acontece ao assinar">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl" aria-hidden />
              <h2 className="relative flex items-center gap-2 font-display text-lg font-bold">
                {expired ? <><Lock className="h-5 w-5 text-err" />O que volta ao pagar</> : <><Sparkles className="h-5 w-5 text-primary" />Como funciona</>}
              </h2>
              {expired ? (
                <div className="relative mt-4 space-y-4 text-sm">
                  <div className="rounded-2xl border border-err/25 bg-err/[0.06] p-4">
                    <p className="font-semibold text-err">Pausado agora</p>
                    <p className="mt-1 text-muted">Acesso ao painel: Resumo, Campanhas, Vendas, Atribuição e o restante das telas.</p>
                  </div>
                  <div className="rounded-2xl border border-ok/25 bg-ok/[0.06] p-4">
                    <p className="font-semibold text-ok">Continua funcionando</p>
                    <p className="mt-1 text-muted">Pixel, webhooks dos gateways e envio de conversões à Meta. Você não perde nenhuma venda nem dado enquanto isso.</p>
                  </div>
                  <p className="text-muted">Pagou, liberou: o painel volta na hora, com todo o histórico.</p>
                </div>
              ) : (
                <ol className="relative mt-5 space-y-4">
                  {[
                    { i: <QrCode />, t: 'Gere o PIX', d: `Um pagamento de ${price} pelo app do seu banco.` },
                    { i: <Zap />, t: 'Liberação automática', d: 'A confirmação chega em segundos; não precisa enviar comprovante.' },
                    { i: <CalendarClock />, t: '30 dias somados', d: 'Contados a partir do vencimento atual: os dias do teste não se perdem.' },
                    { i: <Bell />, t: 'Sem surpresa', d: 'Sem cobrança automática nem fidelidade. Renove quando quiser.' },
                  ].map((x) => (
                    <li key={x.t} className="flex gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{x.i}</span>
                      <div><p className="font-semibold">{x.t}</p><p className="text-sm text-muted">{x.d}</p></div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        {/* ====== tudo que está incluído ====== */}
        <section aria-labelledby="incluido">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">{expired ? 'Desbloqueia ao reativar' : 'Incluído na assinatura'}</p>
              <h2 id="incluido" className="mt-1 font-display text-2xl font-bold sm:text-[28px]">Tudo que você tem com o PayTracking</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Vendas ilimitadas', 'Sem taxa por venda', 'Todas as atualizações'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-3 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20"><Check className="h-3.5 w-3.5" />{t}</span>
              ))}
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {GROUPS.map((g) => (
              <div key={g.title} className="card card-interactive relative overflow-hidden p-5 sm:p-6">
                <div className={clsx('pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-2xl', g.tone)} aria-hidden />
                <div className="relative flex items-center gap-3">
                  <span className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg [&>svg]:h-5 [&>svg]:w-5', g.tone)}>{g.icon}</span>
                  <h3 className="font-display text-[17px] font-bold">{g.title}</h3>
                  {expired && <Lock className="ml-auto h-4 w-4 text-subtle" aria-label="Bloqueado até reativar" />}
                </div>
                <ul className="relative mt-4 grid gap-3">
                  {g.items.map((it) => (
                    <li key={it.t} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary ring-1 ring-inset ring-border [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>
                      <div className="min-w-0"><p className="text-sm font-semibold">{it.t}</p><p className="text-xs leading-relaxed text-muted">{it.d}</p></div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ====== calculadora + dúvidas ====== */}
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <CostPerSale priceMinor={plan.priceMinor} />
          <Card title="Dúvidas rápidas" icon={<KeyRound />}>
            <dl className="space-y-4 text-sm">
              {[
                ['Como é a cobrança?', 'Um PIX por mês, gerado aqui. Não guardamos cartão e não existe cobrança automática.'],
                ['Tem taxa por venda ou limite?', 'Não. O valor é fixo e as vendas são ilimitadas.'],
                ['E se eu não pagar?', 'O painel pausa, mas o rastreamento e o envio à Meta continuam. Pagou, tudo volta na hora.'],
                ['Posso cancelar?', 'Sim, a qualquer momento: é só não renovar. Sem multa.'],
              ].map(([q2, a]) => (
                <div key={q2}><dt className="font-semibold">{q2}</dt><dd className="mt-0.5 text-muted">{a}</dd></div>
              ))}
            </dl>
          </Card>
        </div>

        {/* ====== histórico ====== */}
        <Card title="Histórico de pagamentos" icon={<Receipt />} padded={false}>
          {q.data.charges.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">Nenhuma cobrança ainda.</p> : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[560px]">
                <thead><tr><th>Criada</th><th>Valor</th><th>Status</th><th>Paga em</th></tr></thead>
                <tbody>{q.data.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{dateTime(c.created_at, s.org.timezone)}</td>
                    <td className="num font-semibold">{money(c.amount_minor, 'BRL')}</td>
                    <td><Badge tone={c.status === 'paid' ? 'ok' : c.status === 'pending' ? 'warn' : 'neutral'} dot>{c.status === 'paid' ? 'Paga' : c.status === 'pending' ? 'Pendente' : 'Expirada'}</Badge></td>
                    <td>{dateTime(c.paid_at, s.org.timezone)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** Quanto custa cada venda com o preço fixo (sem estimar nada sobre outras ferramentas). */
function CostPerSale({ priceMinor }: { priceMinor: number }) {
  const [sales, setSales] = useState('100');
  const n = Math.max(0, Math.floor(Number(sales.replace(/\D/g, '')) || 0));
  const per = n > 0 ? Math.round(priceMinor / n) : null;
  return (
    <Card title="Quanto custa cada venda" icon={<Calculator />} description="Preço fixo: quanto mais você vende, menos o PayTracking custa por venda.">
      <label className="label" htmlFor="vendas-mes">Vendas por mês</label>
      <Input id="vendas-mes" inputMode="numeric" value={sales} onChange={(e) => setSales(e.target.value.replace(/\D/g, '').slice(0, 7))} className="max-w-[200px] font-display text-lg font-bold" />
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-xs font-medium text-muted">Custo por venda</p>
          <p className="num font-display text-[34px] font-extrabold leading-tight tracking-tight text-primary">{per !== null ? money(per, 'BRL') : '—'}</p>
        </div>
        <div className="pb-1.5">
          <p className="text-xs font-medium text-muted">Total no mês</p>
          <p className="num text-lg font-semibold">{money(priceMinor, 'BRL')}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {[10, 100, 500, 2000].map((v) => (
          <button key={v} onClick={() => setSales(String(v))}
            className={clsx('rounded-xl border px-2 py-2 text-center text-xs transition', n === v ? 'border-primary bg-primary/[0.08] text-primary' : 'border-border hover:border-border-strong')}>
            <span className="block font-semibold">{v.toLocaleString('pt-BR')}</span>
            <span className="num block text-[11px] text-muted">{money(Math.round(priceMinor / v), 'BRL')}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
