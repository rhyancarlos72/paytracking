import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { get } from '../lib/api';

export interface SupportInfo { whatsapp: string | null; message: string }

export const useSupport = () =>
  useQuery<SupportInfo>({ queryKey: ['support'], queryFn: ({ signal }) => get('/v1/public/support', signal), staleTime: 300_000 });

export function whatsappUrl(number: string, text: string) {
  return `https://wa.me/${number.replace(/\D+/g, '')}?text=${encodeURIComponent(text)}`;
}

/** Ícone do WhatsApp (contorno do balão com o telefone). */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="currentColor">
      <path d="M16.04 3C8.86 3 3.03 8.82 3.03 16c0 2.3.6 4.53 1.74 6.5L3 29l6.68-1.75A12.96 12.96 0 0 0 16.04 29C23.2 29 29 23.18 29 16S23.2 3 16.04 3Zm0 23.64c-2 0-3.95-.54-5.65-1.56l-.4-.24-3.97 1.04 1.06-3.86-.26-.4A10.6 10.6 0 0 1 5.4 16c0-5.87 4.77-10.64 10.65-10.64 5.86 0 10.62 4.77 10.62 10.64 0 5.87-4.77 10.64-10.63 10.64Zm5.83-7.97c-.32-.16-1.89-.93-2.18-1.04-.3-.1-.5-.16-.72.16-.21.32-.82 1.03-1 1.25-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.59-.95-.85-1.59-1.9-1.78-2.21-.18-.32-.02-.5.14-.65.15-.14.32-.37.48-.56.16-.18.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.71-1.72-.98-2.35-.26-.62-.52-.53-.71-.54h-.61c-.21 0-.56.08-.85.4-.29.31-1.11 1.09-1.11 2.65 0 1.57 1.14 3.08 1.3 3.3.16.2 2.24 3.42 5.43 4.8.76.33 1.35.52 1.81.67.76.24 1.45.2 2 .12.61-.09 1.89-.77 2.16-1.52.26-.74.26-1.38.18-1.52-.08-.13-.29-.21-.61-.37Z" />
    </svg>
  );
}

/**
 * Botão flutuante "Fale com o suporte" (WhatsApp). Só aparece quando o dono da plataforma
 * cadastrou o número em Admin → Suporte. `context` entra no começo da mensagem (quem está chamando).
 */
export function SupportButton({ context, className }: { context?: string; className?: string }) {
  const q = useSupport();
  const n = q.data?.whatsapp;
  if (!n) return null;
  const text = [q.data!.message, context].filter(Boolean).join('\n\n');
  return (
    <a href={whatsappUrl(n, text)} target="_blank" rel="noopener noreferrer" aria-label="Falar com o suporte pelo WhatsApp" title="Dúvidas? Fale com o suporte pelo WhatsApp"
      className={clsx('group fixed bottom-5 right-5 z-[55] flex items-center gap-2 rounded-full bg-[#25d366] p-3.5 text-[#0b2e17] shadow-[0_12px_32px_-8px_rgb(37_211_102/0.7)] ring-1 ring-inset ring-black/5 transition hover:-translate-y-0.5 hover:brightness-105 sm:bottom-6 sm:right-6',
        'pb-[max(0.875rem,env(safe-area-inset-bottom))]', className)}>
      <WhatsAppIcon className="h-7 w-7" />
      <span className="hidden pr-1.5 text-sm font-bold sm:group-hover:inline">Suporte</span>
    </a>
  );
}
