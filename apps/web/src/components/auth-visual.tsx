import { CheckCircle2, Fingerprint, KeyRound, Lock, ShieldCheck } from 'lucide-react';

/**
 * Ilustração da tela de login: um "núcleo" protegido (escudo) recebendo os dados dos gateways e
 * entregando à Meta, com o registro ao vivo das verificações. 100% SVG/CSS (sem imagem externa),
 * decorativa (aria-hidden); com "reduzir movimento" fica parada (regra global do CSS).
 */
const NODES = [
  { label: 'Hotmart', x: 64, y: 70 },
  { label: 'Kiwify', x: 396, y: 62 },
  { label: 'Checkout', x: 40, y: 250 },
  { label: 'PIX', x: 424, y: 250 },
  { label: 'Meta CAPI', x: 230, y: 18, accent: true },
] as const;

const C = { x: 230, y: 160 };

export function SecurityVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[420px] select-none" aria-hidden>
      <div className="relative">
      <svg viewBox="0 0 460 320" className="w-full overflow-visible">
        <defs>
          <radialGradient id="sv-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#1d4ed8" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sv-shield" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </linearGradient>
          <linearGradient id="sv-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="sv-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <pattern id="sv-hex" width="22" height="38" patternUnits="userSpaceOnUse" patternTransform="scale(0.9)">
            <path d="M11 0 L22 6.3 L22 19 L11 25.3 L0 19 L0 6.3 Z M11 25.3 L11 38" fill="none" stroke="#93c5fd" strokeOpacity="0.07" strokeWidth="1" />
          </pattern>
          <mask id="sv-fade">
            <radialGradient id="sv-fade-g" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#fff" /><stop offset="100%" stopColor="#000" /></radialGradient>
            <rect width="460" height="320" fill="url(#sv-fade-g)" />
          </mask>
          <filter id="sv-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>

        {/* malha hexagonal e brilho */}
        <rect width="460" height="320" fill="url(#sv-hex)" mask="url(#sv-fade)" />
        <circle cx={C.x} cy={C.y} r="150" fill="url(#sv-glow)" />

        {/* órbitas */}
        {[118, 88, 60].map((r, i) => (
          <g key={r}>
            <ellipse cx={C.x} cy={C.y} rx={r * 1.45} ry={r} fill="none" stroke="#93c5fd" strokeOpacity={0.1 + i * 0.05} strokeDasharray={i === 1 ? '2 6' : undefined} />
            <circle r={i === 2 ? 2.6 : 2} fill="#a5f3fc">
              <animateMotion dur={`${9 + i * 3}s`} repeatCount="indefinite" path={`M ${C.x - r * 1.45} ${C.y} a ${r * 1.45} ${r} 0 1 0 ${r * 2.9} 0 a ${r * 1.45} ${r} 0 1 0 ${-r * 2.9} 0`} />
            </circle>
          </g>
        ))}

        {/* linhas de dados: gateways → núcleo → Meta */}
        {NODES.map((n, i) => (
          <g key={n.label}>
            <line x1={n.x} y1={n.y} x2={C.x} y2={C.y} stroke="#60a5fa" strokeOpacity="0.3" strokeWidth="1" />
            <line x1={n.x} y1={n.y} x2={C.x} y2={C.y} stroke="#67e8f9" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="14 112"
              className="[animation:sv-flow_2.8s_linear_infinite]" style={{ animationDelay: `${-i * 0.55}s`, animationDirection: 'accent' in n ? 'reverse' : 'normal' }} />
          </g>
        ))}

        {/* pulsos do núcleo */}
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={C.x} cy={C.y} r="46" fill="none" stroke="#60a5fa" strokeWidth="1.2"
            className="origin-center [animation:sv-pulse_3.6s_ease-out_infinite] [transform-box:fill-box]" style={{ animationDelay: `${i * 1.2}s` }} />
        ))}

        {/* escudo */}
        <g transform={`translate(${C.x - 42} ${C.y - 50})`}>
          <path d="M42 0 L82 14 V48 C82 74 64 92 42 100 C20 92 2 74 2 48 V14 Z" fill="#1d4ed8" opacity="0.55" filter="url(#sv-blur)" />
          <path d="M42 0 L82 14 V48 C82 74 64 92 42 100 C20 92 2 74 2 48 V14 Z" fill="url(#sv-shield)" stroke="url(#sv-edge)" strokeWidth="1.5" />
          <path d="M42 8 L74 19 V48 C74 69 60 84 42 91 C24 84 10 69 10 48 V19 Z" fill="none" stroke="#bfdbfe" strokeOpacity="0.35" />
          {/* reflexo */}
          <path d="M42 8 L74 19 V30 C60 26 46 30 34 40 C26 46 18 46 10 44 V19 Z" fill="#fff" opacity="0.1" />
          {/* cadeado */}
          <rect x="29" y="44" width="26" height="22" rx="5" fill="#eff6ff" />
          <path d="M34 44 V38 a8 8 0 0 1 16 0 V44" fill="none" stroke="#eff6ff" strokeWidth="4" strokeLinecap="round" />
          <circle cx="42" cy="53" r="3" fill="#1d4ed8" />
          <rect x="40.6" y="54" width="2.8" height="6.5" rx="1.4" fill="#1d4ed8" />
        </g>
      </svg>

      {/* nós (HTML para texto nítido) */}
      {NODES.map((n) => (
        <span key={n.label}
          className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-md ${'accent' in n ? 'border-sky-300/40 bg-sky-400/15 text-sky-100' : 'border-white/15 bg-white/[0.07] text-white/85'}`}
          style={{ left: `${(n.x / 460) * 100}%`, top: `${(n.y / 320) * 100}%` }}>
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${'accent' in n ? 'bg-sky-300' : 'bg-emerald-400'}`} />{n.label}
        </span>
      ))}

      </div>

      {/* registro ao vivo */}
      <div className="relative mx-auto mt-3 w-[94%] overflow-hidden rounded-2xl border border-white/10 bg-[#050a18]/80 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-white/15" /><span className="h-2 w-2 rounded-full bg-white/15" /><span className="h-2 w-2 rounded-full bg-white/15" />
          <span className="ml-2 font-mono text-[10.5px] text-white/45">pipeline · ao vivo</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-300"><span className="live-dot" />protegido</span>
        </div>
        <ul className="space-y-1.5 px-4 py-2.5 font-mono text-[11px] leading-snug">
          {[
            ['webhook recebido', 'assinatura HMAC-SHA256 ✓'],
            ['dados do comprador', 'cifrados · AES-256-GCM'],
            ['status do gateway', 'APROVADO'],
            ['Purchase → Meta', 'entregue · event_id único'],
          ].map(([k, v], i) => (
            <li key={k} className="flex items-center gap-2 opacity-0 [animation:sv-line_8s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.9}s` }}>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="text-white/55">{k}</span>
              <span className="ml-auto truncate text-sky-200">{v}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Selos técnicos (tudo o que está aqui é real no sistema). */
export function TrustBadges({ className = '' }: { className?: string }) {
  const items = [
    { icon: <Lock />, t: 'AES-256-GCM', d: 'dados cifrados' },
    { icon: <KeyRound />, t: 'HMAC-SHA256', d: 'webhooks assinados' },
    { icon: <Fingerprint />, t: '2FA', d: 'duas etapas' },
    { icon: <ShieldCheck />, t: 'LGPD', d: 'privacidade' },
  ];
  return (
    <ul className={`grid grid-cols-2 gap-2.5 sm:grid-cols-4 ${className}`}>
      {items.map((x) => (
        <li key={x.t} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <span className="text-sky-300 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{x.icon}</span>
          <span className="min-w-0"><span className="block text-[12px] font-bold text-white">{x.t}</span><span className="block truncate text-[11px] text-white/55">{x.d}</span></span>
        </li>
      ))}
    </ul>
  );
}
