import clsx from 'clsx';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** Atalho exibido conforme o sistema (⌘K no Mac, Ctrl K nos demais). */
export const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Paleta de comandos (⌘K / Ctrl+K): navegação e ações rápidas, acessível por teclado. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const results = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return commands;
    return commands.filter((c) => { const hay = norm(`${c.label} ${c.group} ${c.keywords ?? ''}`); return terms.every((t) => hay.includes(t)); });
  }, [q, commands]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => input.current?.focus(), 10);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!open) return null;
  const run = (c: Command | undefined) => { if (!c) return; onClose(); c.run(); };
  const groups = [...new Set(results.map((r) => r.group))];
  let index = -1;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Paleta de comandos" className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-pop animate-scale-in"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
          else if (e.key === 'Tab') e.preventDefault(); // foco fica no campo de busca
        }}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar páginas e ações…"
            role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={results[active] ? `${id}-${results[active]!.id}` : undefined}
            aria-label="Buscar páginas e ações" className="h-14 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle" />
          <span className="kbd">Esc</span>
        </div>
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted">Nada encontrado para “{q}”.</li>}
          {groups.map((g) => (
            <li key={g} role="presentation">
              <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-subtle" aria-hidden>{g}</p>
              <ul role="group" aria-label={g}>
                {results.filter((r) => r.group === g).map((c) => {
                  index += 1;
                  const i = index;
                  const isActive = i === active;
                  return (
                    <li key={c.id} id={`${id}-${c.id}`} role="option" aria-selected={isActive} data-active={isActive}
                      onMouseMove={() => setActive(i)} onClick={() => run(c)}
                      className={clsx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                        isActive ? 'bg-primary/10 text-fg' : 'text-muted')}>
                      <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border [&>svg]:h-4 [&>svg]:w-4',
                        isActive ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surface-2')} aria-hidden>{c.icon}</span>
                      <span className={clsx('flex-1 font-medium', isActive && 'text-fg')}>{c.label}</span>
                      {c.hint && <span className="text-xs text-subtle">{c.hint}</span>}
                      {isActive && <CornerDownLeft className="h-4 w-4 text-primary" aria-hidden />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-border bg-surface-2/40 px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> navegar</span>
          <span className="flex items-center gap-1.5"><span className="kbd">Enter</span> abrir</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
