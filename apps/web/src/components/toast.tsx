import clsx from 'clsx';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'err' | 'info';
interface Toast { id: number; tone: Tone; title: string; detail?: string }

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export const useToast = () => {
  const push = useContext(Ctx);
  return {
    ok: (title: string, detail?: string) => push({ tone: 'ok', title, detail }),
    err: (e: unknown, title = 'Não foi possível concluir') => push({ tone: 'err', title, detail: e instanceof Error ? e.message : String(e) }),
    info: (title: string, detail?: string) => push({ tone: 'info', title, detail }),
  };
};

let seq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setItems((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === 'err' ? 7000 : 4000);
  }, []);
  const icon = { ok: <CheckCircle2 className="h-5 w-5 text-ok" />, err: <XCircle className="h-5 w-5 text-err" />, info: <Info className="h-5 w-5 text-info" /> };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-pop animate-fade-in')}>
            {icon[t.tone]}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{t.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
