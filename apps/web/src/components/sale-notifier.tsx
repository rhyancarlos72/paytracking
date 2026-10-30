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
export function useSaleNotifier() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    armAutoUnlock();
    void syncAccountSound(); // som salvo na conta vira o principal neste aparelho
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let floor: string | null = null;
    let cursor: string | null = null;
    const seen = new Set<string>();
    const originalTitle = { value: '' };

    const announce = (sales: FeedSale[]) => {
      const mine = sales.filter((x) => claim(x.id));
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['recent-sales'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      if (!mine.length) return;
      // aba em segundo plano: quem avisa é a notificação do sistema (som/vibração do celular)
      if (document.visibilityState === 'visible') void playSaleSound();
      for (const x of mine.slice(0, 3)) {
        const value = x.amount_minor && x.currency ? money(x.amount_minor, x.currency) : 'valor não informado';
        toastRef.current.ok(`Venda aprovada! ${value}`, [mask('campanha', x.utm_campaign), PROVIDER_LABEL[x.provider] ?? x.provider, mask('pixel', x.pixel_name)].filter(Boolean).join(' · '));
      }
      if (mine.length > 3) toastRef.current.ok(`+${mine.length - 3} venda(s) aprovada(s)`);
      // título da aba pisca a venda por alguns segundos
      if (!originalTitle.value) originalTitle.value = document.title;
      document.title = `💰 ${mine.length > 1 ? `${mine.length} vendas!` : 'Venda aprovada!'} · PayTracking`;
      setTimeout(() => { document.title = originalTitle.value; originalTitle.value = ''; }, 8000);
    };

    const tick = async () => {
      try {
        const r = await get<{ cursor: string; sales: FeedSale[] }>(`/v1/sales/feed${cursor ? qs({ after: cursor, floor: floor ?? undefined }) : ''}`);
        floor ??= r.cursor;
        cursor = r.cursor;
        const fresh = r.sales.filter((x) => !seen.has(x.id));
        fresh.forEach((x) => seen.add(x.id));
        if (fresh.length) announce(fresh);
      } catch { /* sem rede: tenta no próximo ciclo */ }
      if (!stopped) timer = setTimeout(tick, document.hidden ? 30_000 : 15_000);
    };
    void tick();

    // push do service worker (venda aprovada): consulta na hora
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; payload?: { title?: string; body?: string } } | null;
      if (msg?.type === 'sale' && cursor) { clearTimeout(timer); void tick(); }
      // push de teste com o painel aberto: toca o som escolhido para confirmar que está tudo certo
      if (msg?.type === 'sale-test') {
        void playSaleSound();
        toastRef.current.ok(msg.payload?.title ?? 'Notificação de teste', msg.payload?.body);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      stopped = true;
      clearTimeout(timer);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [s.org.id, qc]);
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
