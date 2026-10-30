import clsx from 'clsx';
import { useId, type CSSProperties } from 'react';

/**
 * Marca do PayTracking: "P" com barras subindo e a seta de crescimento (vetor, nítido em qualquer tamanho).
 * Os ids dos degradês são únicos por instância: um logo escondido (display:none) não apaga os outros.
 */
export function LogoMark({ className, glow, onDark }: { className?: string; glow?: boolean; onDark?: boolean }) {
  const id = useId().replace(/:/g, '');
  const u = (n: string) => `${n}-${id}`;
  return (
    <svg viewBox="0 0 100 100" className={clsx(className, glow && 'drop-shadow-[0_0_18px_rgba(139,92,246,.55)]')} aria-hidden
      style={onDark ? ({ '--logo-hi': '#fff', '--logo-mid': '#e6ddff' } as CSSProperties) : undefined}>
      <defs>
        <linearGradient id={u('f')} x1="0.1" y1="0" x2="0.8" y2="1"><stop offset="0" style={{ stopColor: 'var(--logo-hi, #fff)' }} /><stop offset=".45" style={{ stopColor: 'var(--logo-mid, #e6ddff)' }} /><stop offset=".75" stopColor="#ab8cff" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
        <linearGradient id={u('s')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c4a5ff" /><stop offset=".35" stopColor="#a06bff" /><stop offset="1" stopColor="#6d28d9" /></linearGradient>
        <linearGradient id={u('b')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cf8bff" /><stop offset="1" stopColor="#6d28d9" /></linearGradient>
        <linearGradient id={u('a')} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#7c3aed" /><stop offset="1" stopColor="#d86bff" /></linearGradient>
        <clipPath id={u('c')}><path d="M26 88 C36 66 52 63 73 42 L73 8 L20 8 L20 88 Z" /></clipPath>
        <mask id={u('m')} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path d="M26 88 C36 66 52 63 73 42" fill="none" stroke="#000" strokeWidth="13" strokeLinecap="round" />
        </mask>
      </defs>
      <path d="M24 27 V13 H60 A27.5 27.5 0 0 1 60 68 H52 V55 H60 A14.5 14.5 0 0 0 60 26 H38 V27 Z" fill={`url(#${u('f')})`} />
      <g mask={`url(#${u('m')})`}>
        <path d="M24 27 H37 V84 a6 6 0 0 1 -6 6 H30 a6 6 0 0 1 -6 -6 Z" fill={`url(#${u('s')})`} />
        <g clipPath={`url(#${u('c')})`}>
          <rect x="40.5" y="43" width="8" height="40" rx="2.5" fill={`url(#${u('b')})`} />
          <rect x="51" y="36" width="8" height="40" rx="2.5" fill={`url(#${u('b')})`} />
          <rect x="61.5" y="30" width="8" height="40" rx="2.5" fill={`url(#${u('b')})`} />
        </g>
      </g>
      <path d="M26 88 C36 66 52 63 71 44.5" fill="none" stroke={`url(#${u('a')})`} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M84 30 L80.5 51.5 L63.5 37.5 Z" fill="#d86bff" stroke="#d86bff" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

/** "Pay" na cor do texto (ou branco em fundo escuro) + "Tracking" em degradê roxo. */
export function Wordmark({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span className={clsx('font-display font-extrabold tracking-[-0.03em]', className)}>
      <span className={onDark ? 'text-white' : 'text-fg'}>Pay</span>
      <span className="bg-gradient-to-b from-[#d27bff] to-[#7c3aed] bg-clip-text text-transparent">Tracking</span>
    </span>
  );
}

export function Logo({ className, markClassName, textClassName, onDark, glow }: {
  className?: string; markClassName?: string; textClassName?: string; onDark?: boolean; glow?: boolean;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)} aria-label="PayTracking" role="img">
      <LogoMark className={clsx('h-8 w-8 shrink-0', markClassName)} glow={glow} onDark={onDark} />
      <Wordmark className={clsx('text-[19px]', textClassName)} onDark={onDark} />
    </span>
  );
}
