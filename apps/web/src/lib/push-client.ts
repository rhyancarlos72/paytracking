/** Web Push no navegador: suporte, instalação do app (PWA) e inscrição deste dispositivo. */

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

/** Mesmo identificador que o servidor devolve em /v1/push/devices (para marcar "este dispositivo"). */
export const endpointHash = (endpoint: string) => btoa(endpoint).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(-24);

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Pede permissão e inscreve este dispositivo. Se a chave do servidor mudou, refaz a inscrição. */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscription> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone de cadeado ao lado do endereço) e tente de novo.'
      : 'Permissão não concedida.');
  }
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const key = urlB64ToUint8Array(vapidPublicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const same = existing.options.applicationServerKey
      && new Uint8Array(existing.options.applicationServerKey).every((b, i) => b === key[i]);
    if (same) return existing;
    await existing.unsubscribe();
  }
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (e) {
    // o navegador não conseguiu falar com o serviço de push dele (Google/Apple/Mozilla)
    const msg = String((e as Error)?.message ?? e);
    if (/Registration failed|push service|AbortError|NotAllowedError/i.test(msg) || (e as DOMException)?.name === 'AbortError') {
      throw new Error(/Brave/i.test(navigator.userAgent) || (navigator as unknown as { brave?: unknown }).brave
        ? 'O Brave bloqueia o serviço de notificações por padrão: em Configurações → Privacidade, ative “Usar os serviços do Google para mensagens push” e tente de novo.'
        : 'O navegador não conseguiu se registrar no serviço de notificações. Confira a internet, use o Chrome (Android) ou o Safari com o app instalado (iPhone) e tente de novo.');
    }
    throw e;
  }
}

// Android/Chrome: guarda o pedido de instalação para mostrar o botão "Instalar app"
let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as typeof installEvent;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => { installEvent = null; installListeners.forEach((fn) => fn()); });
}
export const canInstall = () => !!installEvent;
export const onInstallChange = (fn: () => void) => { installListeners.add(fn); return () => { installListeners.delete(fn); }; };
export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  installListeners.forEach((fn) => fn());
  return outcome === 'accepted';
}
