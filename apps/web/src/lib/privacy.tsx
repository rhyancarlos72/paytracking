import clsx from 'clsx';
import { EyeOff } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { patch } from './api';

/**
 * Modo privado ("olho"): troca nomes de campanhas, conjuntos e pixels por um código estável
 * (ex.: "Campanha #7K2") em todo o painel — bom para prints, gravações e telas compartilhadas.
 * O mesmo nome sempre vira o mesmo código, então dá para comparar linhas sem ver o nome real.
 * A preferência fica na conta (o push de venda também omite o nome) e em cache local para ser imediata.
 */
const KEY = 'pt_hide_names';
const listeners = new Set<() => void>();
let hidden = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

function set(v: boolean) {
  if (v === hidden) return;
  hidden = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* modo privado do navegador */ }
  listeners.forEach((fn) => fn());
}

export const namesHidden = () => hidden;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useNamesHidden = () => useSyncExternalStore(subscribe, namesHidden);

/** Liga/desliga e salva na conta. */
export async function setNamesHidden(v: boolean) {
  set(v);
  await patch('/v1/auth/preferences', { hideNames: v }).catch(() => undefined);
}

/** Alinha com o valor salvo na conta (vale ao entrar em outro aparelho). */
export function useSyncHideNames(server: boolean | undefined) {
  useEffect(() => { if (server !== undefined) set(server); }, [server]);
}

export type NameKind = 'campanha' | 'conjunto' | 'anuncio' | 'termo' | 'pixel';
const LABEL: Record<NameKind, string> = { campanha: 'Campanha', conjunto: 'Conjunto', anuncio: 'Anúncio', termo: 'Termo', pixel: 'Pixel' };

/** UTMs que costumam carregar nomes de campanha/conjunto/anúncio (utm_source fica visível). */
export const UTM_KIND: Record<string, NameKind | undefined> = { utm_campaign: 'campanha', utm_medium: 'conjunto', utm_content: 'anuncio', utm_term: 'termo' };
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Código curto e estável a partir do nome (FNV-1a), sem revelar o nome. */
export function alias(kind: NameKind, value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let code = '';
  for (let i = 0; i < 3; i++) { code += ALPHA[h % 32]; h = Math.floor(h / 32); }
  return `${LABEL[kind]} #${code}`;
}

/** Para textos fora de JSX (opções de select, toasts, title=…). */
export function mask(kind: NameKind, value: string | null | undefined): string | null | undefined {
  if (!hidden || !value || value === '—') return value;
  return alias(kind, value);
}

/** Nome sensível: mostra o nome ou o código quando o modo privado está ligado. */
export function Name({ kind, value, fallback = '—', className }: { kind: NameKind; value: string | null | undefined; fallback?: string; className?: string }) {
  const h = useNamesHidden();
  if (!value) return <span className={className}>{fallback}</span>;
  if (!h) return <span className={className}>{value}</span>;
  return (
    <span className={clsx('inline-flex max-w-full items-center gap-1', className)}>
      <EyeOff className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
      <span className="truncate">{alias(kind, value)}</span>
    </span>
  );
}
