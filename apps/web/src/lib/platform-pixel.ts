import { useEffect } from 'react';
import { get } from './api';

/**
 * Pixel da própria plataforma (marketing do PayTracking) — só nas páginas públicas (página de
 * vendas e cadastro) e só em produção (o servidor decide em /v1/public/tracking).
 * Nunca roda dentro do painel logado: depois de entrar ou criar a conta a página é recarregada,
 * o que descarta o script da Meta (que leria textos e dados do painel).
 */
interface Cfg { key: string; pixelId: string; script: string; endpoint: string; currency: string; country: string }

let state: 'idle' | 'loading' | 'loaded' | 'off' = 'idle';

export const platformPixelLoaded = () => state === 'loaded';

function inject(c: Cfg) {
  const origin = new URL(c.script).origin;
  for (const href of [origin, 'https://connect.facebook.net']) {
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = href;
    if (href === origin) l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
  // mesmo snippet do painel de Pixels, com os eventos automáticos da Meta desligados
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = c.script;
  s.setAttribute('data-key', c.key);
  s.setAttribute('data-pixel-id', c.pixelId);
  s.setAttribute('data-endpoint', c.endpoint);
  s.setAttribute('data-currency', c.currency);
  s.setAttribute('data-country', c.country);
  s.setAttribute('data-auto-config', '0');
  document.head.appendChild(s);
}

/** Use nas páginas públicas. O servidor só devolve o pixel para visitantes sem sessão. */
export function usePlatformPixel() {
  useEffect(() => {
    if (state === 'loaded') {
      // navegação dentro do app (ex.: página de vendas → cadastro): novo PageView
      (window as unknown as { tracker?: { track: (e: string) => void } }).tracker?.track('page_view');
      return;
    }
    if (state !== 'idle') return;
    state = 'loading';
    get<{ pixel: Cfg | null; signedIn: boolean }>('/v1/public/tracking')
      .then((r) => {
        if (!r?.pixel) { state = r?.signedIn ? 'idle' : 'off'; return; }
        inject(r.pixel);
        state = 'loaded';
      })
      .catch(() => { state = 'idle'; });
  }, []);
}

/** UTMs guardadas pelo pixel (para registrar a origem do cadastro). */
export function storedUtms(): Record<string, string> | undefined {
  try {
    const v = JSON.parse(localStorage.getItem('pt_utms') ?? 'null');
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}
