import clsx from 'clsx';
import { AlertTriangle, Check, Copy, Inbox, Loader2, X } from 'lucide-react';
import {
  cloneElement, forwardRef, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

// ------------------------------------------------------------------ Movimento
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Anima um número até o valor final (respeita "reduzir movimento"). */
export function useCountUp(target: number, durationMs = 900): number {
  const [v, setV] = useState(prefersReducedMotion() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) { setV(target); return; }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - k, 4);
      setV(origin + (target - origin) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'border border-border bg-surface text-fg shadow-sm hover:border-border-strong hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-err text-err-fg shadow-sm hover:bg-err/90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55',
        size === 'sm' ? 'h-8 rounded-lg px-3 text-[13px]' : size === 'lg' ? 'h-12 rounded-xl px-5 text-[15px]' : 'h-10 rounded-xl px-4 text-sm',
        VARIANTS[variant], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Form
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  const descId = useId();
  const hasDesc = !!error || !!hint;
  // liga dica/erro ao campo para leitores de tela (o campo é o filho direto)
  const control = isValidElement(children) && hasDesc
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': descId, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {control}
      {error ? <p id={descId} className="mt-1.5 text-xs font-medium text-err" role="alert">{error}</p> : hint ? <p id={descId} className="hint">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={clsx('input cursor-pointer pr-8', className)} {...p}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx('input h-auto min-h-[84px] py-2.5', className)} {...p} />;
});

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
        checked ? 'btn-primary' : 'bg-surface-3 shadow-inner')}
    >
      <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

// ------------------------------------------------------------------ Layout bits
export function Card({ className, children, title, description, actions, padded = true, icon }: {
  className?: string; children?: ReactNode; title?: ReactNode; description?: ReactNode; actions?: ReactNode; padded?: boolean; icon?: ReactNode;
}) {
  return (
    <section className={clsx('card animate-fade-in', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden>{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : 'pt-3'}>{children}</div>
    </section>
  );
}

export function IconTile({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'primary'; className?: string }) {
  return <span className={clsx(tone === 'primary' ? 'icon-tile-primary' : 'icon-tile', 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5', className)} aria-hidden>{children}</span>;
}

const BADGE: Record<string, string> = {
  neutral: 'bg-surface-2 text-muted ring-border',
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  err: 'bg-err/10 text-err ring-err/25',
  info: 'bg-info/10 text-info ring-info/25',
  primary: 'bg-primary/10 text-primary ring-primary/25',
};
export function Badge({ tone = 'neutral', children, dot }: { tone?: keyof typeof BADGE; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, keyof typeof BADGE> = {
  approved: 'ok', sent: 'ok', processed: 'ok', active: 'ok',
  pending: 'warn', sending: 'info', duplicate: 'neutral', ignored: 'neutral', trial: 'info',
  refunded: 'err', chargeback: 'err', canceled: 'neutral', failed: 'err', dead: 'err', rejected: 'err', expired: 'err',
};

// tons -600/-700: texto branco com contraste ≥ 5:1
const AVATAR_HUES = ['from-violet-600 to-indigo-700', 'from-cyan-700 to-blue-700', 'from-emerald-700 to-teal-700', 'from-amber-700 to-orange-700', 'from-pink-700 to-rose-700', 'from-sky-700 to-indigo-700'];
/** Iniciais com cor estável por nome (decorativo; o nome sempre aparece em texto ao lado). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const clean = name.trim() || '?';
  // só letras e números (ignora colchetes, @, pontos…)
  const initials = (clean.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden className={clsx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white shadow-sm', AVATAR_HUES[h % AVATAR_HUES.length], className)}>
      {initials}
    </span>
  );
}

/** Anel de progresso (0–1). O valor também vai em texto para leitores de tela. */
export function ProgressRing({ value, size = 88, stroke = 8, label, children, done }: { value: number; size?: number; stroke?: number; label: string; children?: ReactNode; done?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, value));
  const gid = useId();
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="progressbar" aria-label={label}
      aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={done ? 'rgb(var(--ok))' : '#60a5fa'} />
            <stop offset="100%" stopColor={done ? 'rgb(var(--ok))' : '#2563eb'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--surface-3))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} className="transition-[stroke-dashoffset] duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-muted', className)} aria-label="Carregando" />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <div className="pointer-events-none absolute left-1/2 top-6 h-32 w-32 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-2 text-primary shadow-sm [&>svg]:h-6 [&>svg]:w-6">
        {icon ?? <Inbox />}
      </div>
      <p className="relative text-base font-semibold">{title}</p>
      {description && <p className="relative mt-1.5 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Algo deu errado.';
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-err/10 text-err"><AlertTriangle className="h-5 w-5" /></div>
      <p className="font-semibold">Não foi possível carregar</p>
      <p className="mt-1 max-w-md text-sm text-muted">{msg}</p>
      {onRetry && <Button className="mt-4" size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'err' | 'ok'; title: string; children?: ReactNode; action?: ReactNode }) {
  const map = {
    info: 'border-info/25 bg-info/[0.06] before:bg-info',
    warn: 'border-warn/25 bg-warn/[0.06] before:bg-warn',
    err: 'border-err/25 bg-err/[0.06] before:bg-err',
    ok: 'border-ok/25 bg-ok/[0.06] before:bg-ok',
  };
  return (
    <div className={clsx('relative flex flex-wrap items-start justify-between gap-3 overflow-hidden rounded-2xl border p-4 pl-5 animate-fade-in before:absolute before:inset-y-0 before:left-0 before:w-1', map[tone])}
      role={tone === 'err' ? 'alert' : 'status'}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ Copy / Code
export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="secondary" icon={done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* */ }
      }}>
      {done ? 'Copiado' : label}
    </Button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2/70">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/60 px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className="flex gap-1" aria-hidden><span className="h-2 w-2 rounded-full bg-err/50" /><span className="h-2 w-2 rounded-full bg-warn/50" /><span className="h-2 w-2 rounded-full bg-ok/50" /></span>
          {label ?? 'Código'}
        </span>
        <CopyButton value={code} />
      </div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all p-3.5 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  );
}

// ------------------------------------------------------------------ Modal (acessível: foco, Esc, aria)
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg';
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      // mantém o foco dentro do diálogo
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
        className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface shadow-pop animate-scale-in sm:rounded-3xl', size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <h2 id={id} className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-2/40 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmButton({ onConfirm, title, description, confirmLabel = 'Confirmar', danger, children, ...btn }: ButtonProps & {
  onConfirm: () => Promise<unknown> | void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button {...btn} onClick={() => setOpen(true)}>{children}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => {
            setBusy(true);
            try { await onConfirm(); setOpen(false); } finally { setBusy(false); }
          }}>{confirmLabel}</Button>
        </>}>
        <p className="text-sm text-muted">Esta ação será registrada no histórico de auditoria.</p>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ Tabs / segmented
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-all duration-150', value === o.value ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2/70 p-1">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx('h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-all duration-150',
            value === t.value ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg')}>
          {t.label}{t.count !== undefined && <span className={clsx('ml-1.5 rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-primary/10 text-primary' : 'bg-surface-3 text-muted')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, hasNext, onPage, total, pageSize }: { page: number; hasNext: boolean; onPage: (p: number) => void; total?: number; pageSize?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
      <span className="num">{total !== undefined && pageSize ? `${Math.min(total, (page - 1) * pageSize + 1)}–${Math.min(total, page * pageSize)} de ${total}` : `Página ${page}`}</span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <Button size="sm" disabled={!hasNext} onClick={() => onPage(page + 1)}>Próxima</Button>
      </div>
    </div>
  );
}
