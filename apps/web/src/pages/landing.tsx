import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight, BadgeCheck, Bell, Check, ChevronDown, CircleDollarSign, Code2, Coins, Layers, LineChart, Lock, Menu,
  MousePointerClick, Plug, Repeat, ShieldCheck, Smartphone, Sparkles, Target, Users, X, Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo, LogoMark } from '../components/logo';
import { get } from '../lib/api';

/**
 * Página de vendas (tela inicial para quem não está logado).
 * Tudo o que é prometido aqui existe no produto; preço e dias de teste vêm do servidor
 * (/v1/public/plan), os mesmos usados na cobrança. Nada de números ou depoimentos inventados.
 */

interface Plan { priceMinor: number; currency: string; trialDays: number }

const brl = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: minor % 100 ? 2 : 0 });

/** Aparece suavemente ao entrar na tela (respeita "reduzir movimento"). */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={clsx('transition-all duration-700 ease-out', shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0', className)}>
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-[32px] font-bold leading-[1.1] sm:text-[44px]">{title}</h2>
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>}
    </Reveal>
  );
}

function CTA({ children = 'Começar teste grátis', className, size = 'lg' }: { children?: ReactNode; className?: string; size?: 'lg' | 'md' }) {
  return (
    <Link to="/criar-conta"
      className={clsx('group relative inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#8467ff] to-[#5b3df5] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(109,74,255,.8)] ring-1 ring-inset ring-white/15 transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_rgba(109,74,255,.9)] active:translate-y-0',
        size === 'lg' ? 'h-14 px-7 text-[16px]' : 'h-11 px-5 text-[15px]', className)}>
      {children}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/* ---------------- topo ---------------- */

const NAV = [['#vantagens', 'Vantagens'], ['#como-funciona', 'Como funciona'], ['#comparativo', 'Comparativo'], ['#preco', 'Preço'], ['#duvidas', 'Dúvidas']] as const;

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={clsx('fixed inset-x-0 top-0 z-50 transition-all duration-300', open ? 'border-b border-white/10 bg-[#07060f]' : scrolled ? 'border-b border-white/10 bg-[#07060f]/85 backdrop-blur-xl' : 'bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#topo" aria-label="PayTracking, início"><Logo onDark glow markClassName="h-9 w-9" textClassName="text-[20px]" /></a>
        <nav className="hidden items-center gap-7 text-sm text-white/70 lg:flex" aria-label="Seções">
          {NAV.map(([href, label]) => <a key={href} href={href} className="transition hover:text-white">{label}</a>)}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link to="/entrar" className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white">Entrar</Link>
          <CTA size="md">Testar grátis</CTA>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-xl text-white lg:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto border-t border-white/10 bg-[#07060f] px-4 pb-8 pt-2 lg:hidden">
          <nav className="flex flex-col" aria-label="Seções">
            {NAV.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)} className="border-b border-white/5 py-3.5 text-[15px] text-white/80">{label}</a>)}
          </nav>
          <div className="mt-5 grid gap-3">
            <CTA size="md" className="w-full">Testar grátis</CTA>
            <Link to="/entrar" className="flex h-11 items-center justify-center rounded-2xl border border-white/15 text-[15px] font-medium text-white">Entrar</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------------- herói ---------------- */

/** Peça visual do herói: a marca em vidro, com brilho e os avisos do produto em órbita. */
function BrandMock() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[500px]" aria-hidden>
      <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,.55),rgba(109,40,217,.12)_55%,transparent_70%)] blur-2xl" />
      <div className="absolute inset-[4%] rounded-full border border-white/[0.07]" />
      <div className="absolute inset-[16%] animate-[spin_40s_linear_infinite] rounded-full border border-dashed border-violet-300/20" />
      <div className="absolute inset-[22%] rounded-[34%] border border-white/15 bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[0_30px_80px_-20px_rgba(109,74,255,.65),inset_0_1px_0_rgba(255,255,255,.18)] backdrop-blur-xl">
        <LogoMark onDark className="absolute inset-[14%] h-[72%] w-[72%] drop-shadow-[0_0_30px_rgba(167,139,250,.65)]" />
      </div>
      <div className="absolute left-0 top-[6%] w-[236px] animate-float rounded-2xl border border-white/10 bg-[#121027]/90 p-3 shadow-2xl backdrop-blur-xl sm:-left-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><Bell className="h-4 w-4" /></span>
          <div className="min-w-0"><p className="whitespace-nowrap text-[13px] font-semibold text-white">Venda aprovada! R$ 197,00</p><p className="text-[11px] text-white/55">Campanha Black · PIX</p></div>
        </div>
      </div>
      <div className="absolute right-0 top-[44%] animate-float rounded-2xl border border-white/10 bg-[#121027]/90 px-4 py-3 shadow-2xl backdrop-blur-xl [animation-delay:-2s] sm:-right-4">
        <p className="text-[11px] text-white/55">ROAS hoje</p>
        <p className="font-display text-xl font-extrabold text-white">4,2<span className="ml-1 text-sm font-semibold text-emerald-300">▲</span></p>
      </div>
      <div className="absolute bottom-[6%] left-[8%] animate-float rounded-full border border-white/10 bg-[#121027]/90 px-4 py-2 text-xs text-white/85 shadow-xl backdrop-blur-xl [animation-delay:-4s]">
        <Zap className="mr-1.5 inline h-3.5 w-3.5 text-violet-300" />Purchase entregue à Meta
      </div>
    </div>
  );
}

/** Mockup do painel (valores de exemplo). */
function DashboardMock() {
  const bars = [38, 52, 44, 63, 58, 72, 66, 84, 78, 92, 88, 100];
  const rows: Array<[string, string, string]> = [['Campanha Black · Criativo 03', 'R$ 1.182,00', '5,1'], ['Remarketing 7 dias', 'R$ 985,00', '4,4'], ['Lookalike compradores', 'R$ 591,00', '3,2']];
  return (
    <div className="relative mx-auto w-full max-w-5xl" aria-hidden>
      <div className="absolute -inset-8 rounded-[40px] bg-gradient-to-tr from-[#6d4aff]/35 via-fuchsia-500/10 to-cyan-400/25 blur-3xl" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.05] p-2 shadow-2xl backdrop-blur-xl">
        <div className="rounded-[20px] border border-white/10 bg-[#0d0b1d]/95">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
            <Logo onDark markClassName="h-6 w-6" textClassName="text-[14px]" />
            <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /></div>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl bg-white/[0.03] p-5">
              <div className="flex items-start justify-between">
                <div><p className="text-xs text-white/55">Receita confirmada · hoje</p><p className="mt-1 font-display text-[30px] font-extrabold tracking-tight text-white">R$ 3.546,00</p></div>
                <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">ROAS 4,2</span>
              </div>
              <div className="mt-5 flex h-32 items-end gap-1.5">
                {bars.map((h, i) => <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-[#6d4aff]/60 to-[#c084fc]" style={{ height: `${h}%`, opacity: 0.45 + i * 0.045 }} />)}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[['Vendas', '18'], ['Investido', 'R$ 842'], ['Purchase na Meta', '18/18']].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/[0.04] px-2 py-2.5"><p className="text-[11px] text-white/50">{k}</p><p className="mt-0.5 text-sm font-semibold text-white">{v}</p></div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/45">Campanhas que mais venderam</p>
              <ul className="mt-4 space-y-3">
                {rows.map(([n, v, r]) => (
                  <li key={n} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3.5 py-3">
                    <div className="min-w-0"><p className="truncate text-[13px] font-medium text-white">{n}</p><p className="text-[11px] text-white/50">{v}</p></div>
                    <span className="shrink-0 rounded-lg bg-violet-400/15 px-2 py-1 text-xs font-bold text-violet-200">ROAS {r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ plan }: { plan?: Plan }) {
  return (
    <section id="topo" className="relative overflow-hidden bg-[#07060f] pb-24 pt-32 text-white sm:pb-32 sm:pt-40">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] animate-drift rounded-full bg-[#6d4aff]/35 blur-[130px]" aria-hidden />
      <div className="pointer-events-none absolute -right-40 top-40 h-[480px] w-[480px] animate-drift rounded-full bg-cyan-400/15 blur-[130px] [animation-delay:-8s]" aria-hidden />
      <div className="grid-fade opacity-50 [--fg:255_255_255]" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[13px] font-medium text-white/85">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />{plan?.trialDays ?? 7} dias grátis · sem cartão de crédito
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-6 text-[42px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[62px]">
              Saiba qual anúncio{' '}
              <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">realmente vende.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-white/70">
              O PayTracking liga cada venda aprovada ao anúncio que a trouxe e entrega a conversão certa para a Meta.
              <b className="font-semibold text-white"> Preço fixo por mês, vendas ilimitadas e zero taxa por venda.</b>
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <CTA>Começar meus {plan?.trialDays ?? 7} dias grátis</CTA>
              <a href="#como-funciona" className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/15 px-6 text-[15px] font-medium text-white/90 transition hover:bg-white/[0.06]">Ver como funciona</a>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/65">
              {['Vendas ilimitadas', 'Sem taxa por venda', 'Cancele quando quiser'].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-300" aria-hidden />{t}</li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal delay={200}><BrandMock /></Reveal>
      </div>
      <Reveal className="relative mx-auto mt-24 max-w-5xl px-4 sm:px-6">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Funciona com</p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {['Hotmart', 'Kiwify', 'Kirvano', 'Cakto', 'Checkout próprio (PHP)', 'Meta Ads', 'Pixel + Conversions API'].map((n) => (
            <li key={n} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/75">{n}</li>
          ))}
        </ul>
      </Reveal>
      <div className="relative mx-auto mt-28 max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-violet-300">Seu painel</p>
          <h2 className="mt-3 text-[32px] font-bold leading-[1.1] sm:text-[44px]">Receita, campanha e ROAS na mesma tela</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-white/65">Cada venda aprovada aparece com a campanha de origem, e a Meta recebe a mesma venda pelo servidor.</p>
        </Reveal>
        <Reveal><DashboardMock /></Reveal>
        <p className="mt-6 text-center text-[11px] text-white/35">Imagem ilustrativa, com valores de exemplo</p>
      </div>
    </section>
  );
}

/* ---------------- problema ---------------- */

function Problem() {
  const items = [
    { icon: <Target className="h-5 w-5" />, t: 'Venda que não aparece', d: 'Bloqueadores, navegação privada e restrições do iPhone fazem o Pixel do navegador perder conversões. A Meta otimiza às cegas.' },
    { icon: <Coins className="h-5 w-5" />, t: 'Purchase que não foi pago', d: 'PIX gerado não é venda. Quando a conversão dispara antes do pagamento, a campanha aprende com quem nunca pagou.' },
    { icon: <LineChart className="h-5 w-5" />, t: 'ROAS que não bate', d: 'Gasto em um lugar, vendas em outro, moedas diferentes. Sem número confiável, escalar vira aposta.' },
  ];
  return (
    <section className="relative bg-bg py-24 sm:py-32">
      <SectionTitle eyebrow="O problema" title={<>Você está tomando decisão com <span className="text-primary">dado incompleto</span></>}
        sub="Se a Meta não recebe as vendas certas, ela não sabe quem é o seu comprador. E você não sabe qual anúncio escalar." />
      <div className="mx-auto mt-14 grid max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-3">
        {items.map((x, i) => (
          <Reveal key={x.t} delay={i * 90}>
            <div className="h-full rounded-3xl border border-border bg-surface p-7 shadow-sm">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-err/10 text-err">{x.icon}</span>
              <h3 className="mt-5 text-[19px] font-bold">{x.t}</h3>
              <p className="mt-2.5 leading-relaxed text-muted">{x.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- vantagens ---------------- */

const BENEFITS: Array<{ icon: ReactNode; t: string; d: string; big?: boolean }> = [
  { icon: <BadgeCheck className="h-5 w-5" />, t: 'Purchase só com pagamento aprovado', d: 'A conversão é enviada quando o gateway confirma o pagamento, nunca quando o PIX é gerado. Reembolso e chargeback também são registrados.', big: true },
  { icon: <Layers className="h-5 w-5" />, t: 'Pixel + Conversions API sem duplicar', d: 'O mesmo event_id no navegador e no servidor: a Meta junta os dois e conta uma venda só.', big: true },
  { icon: <CircleDollarSign className="h-5 w-5" />, t: 'ROAS real por campanha', d: 'Conecte sua conta de anúncios e veja investimento, receita confirmada e ROAS lado a lado, em uma moeda só.' },
  { icon: <Bell className="h-5 w-5" />, t: 'Venda no celular, na hora', d: 'Notificação no celular a cada venda aprovada e som de venda com o painel aberto.' },
  { icon: <MousePointerClick className="h-5 w-5" />, t: 'UTM e clique preservados', d: 'fbclid, fbc e UTMs seguem do anúncio até o checkout, inclusive em outro domínio.' },
  { icon: <Code2 className="h-5 w-5" />, t: 'Checkout próprio integrado', d: 'Arquivo PHP pronto para o seu checkout: duas linhas de código e as vendas chegam assinadas e seguras.' },
  { icon: <Repeat className="h-5 w-5" />, t: 'Migre sem duplicar', d: 'Modo sombra: registra tudo no painel sem enviar à Meta enquanto o sistema antigo ainda está ligado.' },
  { icon: <Users className="h-5 w-5" />, t: 'Equipe com permissões', d: 'Convide gestor e analista com níveis de acesso diferentes. As ações importantes ficam registradas.' },
  { icon: <ShieldCheck className="h-5 w-5" />, t: 'Segurança de verdade', d: 'Verificação em duas etapas, login com Google, tokens criptografados e alerta por e-mail a cada mudança sensível.' },
];

function Benefits() {
  return (
    <section id="vantagens" className="relative scroll-mt-16 bg-bg pb-24 sm:pb-32">
      <SectionTitle eyebrow="O que você ganha" title="Tudo para a Meta otimizar com venda de verdade"
        sub="Uma ferramenta, um preço, todos os recursos. Sem plano básico que esconde o que importa." />
      <div className="mx-auto mt-14 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((b, i) => (
          <Reveal key={b.t} delay={(i % 3) * 80} className={clsx(b.big && 'lg:col-span-1')}>
            <div className={clsx('group h-full rounded-3xl border p-7 transition duration-300 hover:-translate-y-1 hover:shadow-xl',
              b.big ? 'border-primary/25 bg-gradient-to-b from-primary/[0.08] to-surface' : 'border-border bg-surface')}>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary transition group-hover:scale-110">{b.icon}</span>
              <h3 className="mt-5 text-[18px] font-bold">{b.t}</h3>
              <p className="mt-2.5 leading-relaxed text-muted">{b.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- como funciona ---------------- */

function HowItWorks() {
  const steps = [
    { icon: <Plug className="h-5 w-5" />, t: 'Conecte o gateway', d: 'Cole a URL do webhook na Hotmart, Kiwify, Kirvano, Cakto, ou instale o arquivo no seu checkout próprio.' },
    { icon: <Code2 className="h-5 w-5" />, t: 'Instale o pixel', d: 'Um único código na página de vendas. Leve, assíncrono e sem atrasar o carregamento.' },
    { icon: <Smartphone className="h-5 w-5" />, t: 'Acompanhe e escale', d: 'Cada venda aprovada vira Purchase na Meta e aparece no painel e no celular com a campanha de origem.' },
  ];
  return (
    <section id="como-funciona" className="relative scroll-mt-16 overflow-hidden bg-[#07060f] py-24 text-white sm:py-32">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-[#6d4aff]/25 blur-[140px]" aria-hidden />
      <Reveal className="relative mx-auto max-w-2xl px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-violet-300">Como funciona</p>
        <h2 className="mt-3 text-[32px] font-bold leading-[1.1] sm:text-[44px]">Pronto em minutos</h2>
      </Reveal>
      <ol className="relative mx-auto mt-16 grid max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.t} delay={i * 120}>
            <li className="relative h-full rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-200">{s.icon}</span>
                <span className="text-[44px] font-semibold leading-none text-white/10">0{i + 1}</span>
              </div>
              <h3 className="mt-6 text-[19px] font-bold">{s.t}</h3>
              <p className="mt-2.5 leading-relaxed text-white/65">{s.d}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/* ---------------- comparativo ---------------- */

type Cell = true | false | string;
const ROWS: Array<[string, Cell, Cell, Cell]> = [
  ['Purchase só com pagamento aprovado', true, 'Depende de onde dispara', 'Depende da ferramenta'],
  ['Conversões pelo servidor (Conversions API)', true, false, 'Em geral, sim'],
  ['Pixel + servidor sem duplicar venda', true, 'Não se aplica', 'Depende da configuração'],
  ['Reembolso e chargeback registrados', true, false, 'Depende da ferramenta'],
  ['Checkout próprio (PHP) com envio assinado', true, false, 'Raro'],
  ['Notificação de venda no celular', true, false, 'Varia'],
  ['Preço fixo, sem taxa por venda', true, 'Grátis', 'Muitas cobram por faixa de faturamento'],
  ['Vendas ilimitadas', true, true, 'Muitos planos têm limite'],
];

function Mark({ v, highlight }: { v: Cell; highlight?: boolean }) {
  if (v === true) return <span className={clsx('inline-flex h-7 w-7 items-center justify-center rounded-full', highlight ? 'bg-primary text-white' : 'bg-ok/15 text-ok')}><Check className="h-4 w-4" aria-label="Sim" /></span>;
  if (v === false) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-subtle"><X className="h-4 w-4" aria-label="Não" /></span>;
  return <span className="text-[13px] leading-snug text-muted">{v}</span>;
}

function Comparison() {
  return (
    <section id="comparativo" className="scroll-mt-16 bg-bg py-24 sm:py-32">
      <SectionTitle eyebrow="Comparativo" title="Por que o PayTracking é diferente"
        sub="Feito para quem vende infoproduto e checkout próprio no Brasil: venda confirmada, preço fixo e nenhuma taxa sobre o que você fatura." />
      <Reveal className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[38%] px-6 py-5 font-medium text-muted" scope="col">Recurso</th>
                  <th className="bg-primary/[0.06] px-4 py-5 text-center" scope="col">
                    <Logo markClassName="h-6 w-6" textClassName="text-[15px]" />
                  </th>
                  <th className="px-4 py-5 text-center font-semibold" scope="col">Só o Pixel da Meta</th>
                  <th className="px-4 py-5 text-center font-semibold" scope="col">Outras ferramentas de rastreio</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, a, b, c]) => (
                  <tr key={label} className="border-b border-border last:border-0">
                    <th scope="row" className="px-6 py-4 font-medium">{label}</th>
                    <td className="bg-primary/[0.06] px-4 py-4 text-center"><Mark v={a} highlight /></td>
                    <td className="px-4 py-4 text-center"><Mark v={b} /></td>
                    <td className="px-4 py-4 text-center"><Mark v={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-subtle">“Outras ferramentas” resume o que é comum no mercado e varia de acordo com a ferramenta e o plano. Compare sempre as condições atuais de cada uma.</p>
      </Reveal>
    </section>
  );
}

/* ---------------- preço ---------------- */

function Pricing({ plan }: { plan?: Plan }) {
  const price = plan ? brl(plan.priceMinor) : '—';
  const days = plan?.trialDays ?? 7;
  const included = [
    'Vendas ilimitadas', 'Zero taxa ou porcentagem por venda', 'Pixels e integrações ilimitados', 'Pixel + Conversions API com deduplicação',
    'Hotmart, Kiwify, Kirvano, Cakto e checkout próprio', 'ROAS com o gasto da Meta Ads', 'Notificação de venda no celular',
    'Equipe com permissões', 'Verificação em duas etapas e login com Google', 'Todas as atualizações incluídas',
  ];
  return (
    <section id="preco" className="relative scroll-mt-16 overflow-hidden bg-bg pb-24 sm:pb-32">
      <SectionTitle eyebrow="Preço" title={<>Um preço. <span className="text-primary">Tudo incluído.</span></>}
        sub="Sem plano básico, sem taxa escondida, sem cobrar mais porque você vendeu mais." />
      <Reveal className="relative mx-auto mt-14 max-w-4xl px-4 sm:px-6">
        <div className="absolute inset-x-10 -top-6 bottom-0 rounded-[40px] bg-gradient-to-tr from-[#6d4aff]/25 via-fuchsia-400/10 to-cyan-300/20 blur-3xl" aria-hidden />
        <div className="relative grid overflow-hidden rounded-[28px] border border-primary/25 bg-surface shadow-2xl md:grid-cols-[1fr_1.1fr]">
          <div className="relative overflow-hidden bg-[#07060f] p-8 text-white sm:p-10">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#6d4aff]/40 blur-[90px]" aria-hidden />
            <p className="relative inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300"><Sparkles className="h-3.5 w-3.5" />{days} dias grátis</p>
            <h3 className="relative mt-6 text-lg font-semibold text-white/80">PayTracking completo</h3>
            <p className="relative mt-3 flex items-baseline gap-2">
              <span className="font-display text-[60px] font-extrabold leading-none tracking-[-0.04em]">{price}</span><span className="text-white/60">/mês</span>
            </p>
            <p className="relative mt-4 leading-relaxed text-white/65">Pagamento único mensal por PIX. Sem fidelidade e sem cobrança automática no cartão: você só paga se quiser continuar.</p>
            <CTA className="relative mt-8 w-full">Começar teste grátis</CTA>
            <p className="relative mt-4 flex items-center justify-center gap-1.5 text-xs text-white/55"><Lock className="h-3.5 w-3.5" />Não pedimos cartão para testar</p>
          </div>
          <div className="p-8 sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Está tudo incluído</p>
            <ul className="mt-5 grid gap-3">
              {included.map((t) => (
                <li key={t} className="flex gap-3 text-[15px]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-3.5 w-3.5" aria-hidden /></span>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
      <Reveal className="mx-auto mt-10 grid max-w-4xl gap-4 px-4 sm:grid-cols-3 sm:px-6">
        {[['Vendeu 10 ou 10.000', 'O preço continua o mesmo.'], ['Sem porcentagem', 'Nenhum centavo sobre o seu faturamento.'], ['Sem surpresa', 'O valor da página é o valor da cobrança.']].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-border bg-surface p-5 text-center"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></div>
        ))}
      </Reveal>
    </section>
  );
}

/* ---------------- dúvidas ---------------- */

function Faq({ plan }: { plan?: Plan }) {
  const days = plan?.trialDays ?? 7;
  const items: Array<[string, string]> = [
    ['Preciso de cartão para testar?', `Não. Você cria a conta e usa tudo por ${days} dias, sem cadastrar cartão.`],
    ['Como funciona o pagamento?', 'É um pagamento único por mês, feito por PIX dentro do painel. Não existe cobrança automática: se não pagar, o acesso ao painel pausa e nada é cobrado (o rastreamento continua funcionando enquanto isso).'],
    ['Tem taxa por venda ou limite de vendas?', 'Não. O valor mensal é fixo e as vendas são ilimitadas. Não cobramos porcentagem sobre o seu faturamento.'],
    ['Funciona com o meu checkout próprio?', 'Sim. Você baixa um arquivo PHP pronto no painel e chama duas funções no seu checkout: quando o PIX é gerado e quando o pagamento é aprovado.'],
    ['Quais plataformas são suportadas?', 'Hotmart, Kiwify, Kirvano, Cakto e checkout próprio, com Pixel e Conversions API da Meta. A conta de anúncios da Meta pode ser conectada para mostrar o investimento e o ROAS.'],
    ['Já uso outra ferramenta. Vou duplicar as vendas na Meta?', 'Não precisa. Ative o modo sombra: o PayTracking registra tudo no painel sem enviar à Meta até você desligar a ferramenta antiga.'],
    ['O pixel deixa minha página lenta?', 'Não. O script é pequeno, carrega de forma assíncrona e é entregue comprimido e em cache. Ele não bloqueia a exibição da página.'],
    ['Meus dados ficam seguros?', 'Tokens e segredos ficam criptografados, o acesso pode exigir verificação em duas etapas e você recebe alerta por e-mail a cada mudança importante na conta.'],
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="duvidas" className="scroll-mt-16 bg-bg pb-24 sm:pb-32">
      <SectionTitle eyebrow="Dúvidas" title="Perguntas frequentes" />
      <Reveal className="mx-auto mt-12 max-w-3xl px-4 sm:px-6">
        <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
          {items.map(([q, a], i) => (
            <div key={q}>
              <h3>
                <button className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-[16px] font-semibold transition hover:bg-surface-2/60"
                  aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)}>
                  {q}<ChevronDown className={clsx('h-5 w-5 shrink-0 text-muted transition-transform duration-300', open === i && 'rotate-180')} aria-hidden />
                </button>
              </h3>
              <div id={`faq-${i}`} role="region" hidden={open !== i} className="px-6 pb-6 leading-relaxed text-muted">{a}</div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- chamada final + rodapé ---------------- */

function FinalCta({ plan }: { plan?: Plan }) {
  return (
    <section className="px-4 pb-24 sm:px-6 sm:pb-32">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-[#07060f] px-6 py-16 text-center text-white sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute -left-20 -top-24 h-80 w-80 rounded-full bg-[#6d4aff]/45 blur-[110px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-cyan-400/20 blur-[110px]" aria-hidden />
        <h2 className="relative mx-auto max-w-2xl text-[32px] font-extrabold leading-[1.08] sm:text-[48px]">Comece hoje. Veja a primeira venda rastreada ainda nesta semana.</h2>
        <p className="relative mx-auto mt-5 max-w-xl text-[17px] text-white/70">
          {plan?.trialDays ?? 7} dias grátis, depois {plan ? brl(plan.priceMinor) : 'um valor fixo'} por mês. Vendas ilimitadas, sem taxa por venda.
        </p>
        <div className="relative mt-9 flex justify-center"><CTA>Criar minha conta grátis</CTA></div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:px-6">
        <div className="flex items-center gap-3"><Logo markClassName="h-7 w-7" textClassName="text-[16px]" /><span>© {new Date().getFullYear()}</span></div>
        <nav className="flex flex-wrap items-center gap-5" aria-label="Rodapé">
          <a href="#preco" className="hover:text-fg">Preço</a>
          <a href="#duvidas" className="hover:text-fg">Dúvidas</a>
          <a href="/privacidade" className="hover:text-fg">Privacidade</a>
          <a href="/termos" className="hover:text-fg">Termos</a>
          <Link to="/entrar" className="hover:text-fg">Entrar</Link>
          <Link to="/criar-conta" className="font-semibold text-primary hover:underline">Teste grátis</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Barra fixa no celular com a chamada principal (aparece depois do topo). */
function MobileBar({ plan }: { plan?: Plan }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 640);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <div className={clsx('fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-xl transition-transform duration-300 sm:hidden', show ? 'translate-y-0' : 'translate-y-full')}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm leading-tight"><p className="font-semibold">{plan?.trialDays ?? 7} dias grátis</p><p className="text-muted">depois {plan ? brl(plan.priceMinor) : ''}/mês</p></div>
        <CTA size="md">Testar grátis</CTA>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const plan = useQuery({ queryKey: ['public-plan'], queryFn: () => get<Plan>('/v1/public/plan'), staleTime: 300_000, retry: 1 });
  useEffect(() => {
    document.title = 'PayTracking · Rastreamento de vendas para Meta Ads sem taxa por venda';
    // os títulos ancorados descontam o cabeçalho fixo; rolagem suave só sem "reduzir movimento"
    const root = document.documentElement;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) root.style.scrollBehavior = 'smooth';
    return () => { root.style.scrollBehavior = ''; };
  }, []);
  return (
    <div className="min-h-screen bg-bg text-fg">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2">Pular para o conteúdo</a>
      <Header />
      <main id="conteudo">
        <Hero plan={plan.data} />
        <Problem />
        <Benefits />
        <HowItWorks />
        <Comparison />
        <Pricing plan={plan.data} />
        <Faq plan={plan.data} />
        <FinalCta plan={plan.data} />
      </main>
      <Footer />
      <MobileBar plan={plan.data} />
    </div>
  );
}
