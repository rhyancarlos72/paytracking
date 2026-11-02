import { useQueryClient } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get, qs } from '../lib/api';
import { money, PROVIDER_LABEL } from '../lib/format';
import { armAutoUnlock, audioUnlocked, loadSettings, onSoundChange, playSaleSound, syncAccountSound, unlockAudio } from '../lib/sale-sound';
import { useSession } from '../lib/session';
import { useToast } from './toast';
import { mask } from '../lib/privacy';

interface FeedSale { id: string; provider: string; transaction_id: string; amount_minor: string | null; currency: string | null; utm_campaign: string | null; pixel_name: string | null }

const PLAYED_KEY = 'pt_sale_played';

/**
 * Celular/tablet: com o app em segundo plano o JS fica congelado e quem avisa é a notificação do sistema.
 * Computador: a aba em segundo plano CONTINUA tocando (o navegador permite depois do primeiro clique),
 * porque a notificação do Windows/Mac costuma chegar sem som — era o "sem som no desktop".
 */
export function isMobileDevice(): boolean {
  const n = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (typeof n.userAgentData?.mobile === 'boolean') return n.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1);
}
/** Marca a venda como avisada; false se outra aba já avisou (evita som repetido com várias abas abertas). */
function claim(id: string): boolean {
  try {
    const now = Date.now();
    const played = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '{}') as Record<string, number>;
    if (played[id]) return false;
    played[id] = now;
    for (const [k, v] of Object.entries(played)) if (now - v > 6 * 3600_000) delete played[k];
    localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
    return true;
  } catch {
    return true;
  }
}

/**
 * Aviso de venda aprovada em qualquer página do painel: toca o som escolhido, mostra o valor e
 * atualiza os números. Consulta a cada 15 s (30 s com a aba em segundo plano) e na hora em que
 * chega um push do service worker.
 */
export function useSaleNotifier(enabled = true) {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!enabled) return; // painel bloqueado (assinatura vencida): não consulta o feed de vendas
    armAutoUnlock();
    void syncAccountSound(); // som salvo na conta vira o principal neste aparelho
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let floor: string | null = null;
    let cursor: string | null = null;
    const seen = new Set<string>();
    const originalTitle = { value: '' };

    /** Devolve true se ESTE painel tocou o som (o service worker então deixa a notificação muda). */
    const announce = async (sales: FeedSale[]): Promise<boolean> => {
      const mine = sales.filter((x) => claim(x.id));
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['recent-sales'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      if (!mine.length) return false;
      // celular com o app em segundo plano: quem avisa é a notificação do sistema (som/vibração)
      const played = document.visibilityState === 'visible' || !isMobileDevice() ? await playSaleSound().catch(() => false) : false;
      for (const x of mine.slice(0, 3)) {
        const value = x.amount_minor && x.currency ? money(x.amount_minor, x.currency) : 'valor não informado';
        toastRef.current.ok(`Venda aprovada! ${value}`, [mask('campanha', x.utm_campaign), PROVIDER_LABEL[x.provider] ?? x.provider, mask('pixel', x.pixel_name)].filter(Boolean).join(' · '));
      }
      if (mine.length > 3) toastRef.current.ok(`+${mine.length - 3} venda(s) aprovada(s)`);
      // título da aba pisca a venda por alguns segundos
      if (!originalTitle.value) originalTitle.value = document.title;
      document.title = `💰 ${mine.length > 1 ? `${mine.length} vendas!` : 'Venda aprovada!'} · PayTracking`;
      setTimeout(() => { document.title = originalTitle.value; originalTitle.value = ''; }, 8000);
      return played;
    };

    const tick = async (): Promise<boolean> => {
      let played = false;
      try {
        const r = await get<{ cursor: string; sales: FeedSale[] }>(`/v1/sales/feed${cursor ? qs({ after: cursor, floor: floor ?? undefined }) : ''}`);
        floor ??= r.cursor;
        cursor = r.cursor;
        const fresh = r.sales.filter((x) => !seen.has(x.id));
        fresh.forEach((x) => seen.add(x.id));
        if (fresh.length) played = await announce(fresh);
      } catch { /* sem rede: tenta no próximo ciclo */ }
      if (!stopped) timer = setTimeout(() => void tick(), document.hidden ? 30_000 : 15_000);
      return played;
    };
    void tick();

    // push do service worker (venda aprovada): consulta na hora e responde se tocou o som
    const onMessage = async (e: MessageEvent) => {
      const msg = e.data as { type?: string; payload?: { title?: string; body?: string } } | null;
      const reply = (played: boolean) => e.ports?.[0]?.postMessage({ played });
      if (msg?.type === 'sale') {
        if (!cursor) return reply(false);
        clearTimeout(timer);
        reply(await tick());
      }
      // push de teste com o painel aberto: toca o som escolhido para confirmar que está tudo certo
      if (msg?.type === 'sale-test') {
        const canPlay = document.visibilityState === 'visible' || !isMobileDevice();
        reply(canPlay ? await playSaleSound().catch(() => false) : false);
        toastRef.current.ok(msg.payload?.title ?? 'Notificação de teste', msg.payload?.body);
      }
    };
    const onSwMessage = (e: MessageEvent) => void onMessage(e);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      stopped = true;
      clearTimeout(timer);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [s.org.id, qc, enabled]);
}

/** Botão discreto na barra superior enquanto o navegador não liberou o som (política de autoplay). */
export function SoundUnlockButton() {
  const [, force] = useState(0);
  useEffect(() => onSoundChange(() => force((n) => n + 1)), []);
  const settings = loadSettings();
  if (!settings.enabled || audioUnlocked()) return null;
  return (
    <button onClick={async () => { await unlockAudio(); void playSaleSound({ volume: settings.volume * 0.6 }); }}
      className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/15 sm:inline-flex"
      title="O navegador só toca sons depois de um clique na página">
      <Volume2 className="h-3.5 w-3.5" aria-hidden />Ativar som de vendas
    </button>
  );
}
