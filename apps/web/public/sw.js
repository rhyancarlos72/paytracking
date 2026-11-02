// Service worker do PayTracking: notificações de venda (Web Push).
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/** Só abre caminhos do próprio painel (nunca um link externo vindo no push). */
function safeUrl(url) {
  try {
    const u = new URL(url || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + '/';
  } catch (e) {
    return self.location.origin + '/';
  }
}

/** Manda a mensagem para uma janela do painel e espera a resposta (ou null depois de `ms`). */
function ask(client, msg, ms) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data || null); };
    try { client.postMessage(msg, [ch.port2]); } catch (e) { clearTimeout(t); resolve(null); }
  });
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // painel aberto: avisa a página (ela atualiza os números e toca o som escolhido) e espera ela
    // dizer se tocou. Tocou → notificação muda (sem dois sons). Não tocou (celular com o app em
    // segundo plano, som bloqueado, painel fechado) → a notificação toca o som do sistema.
    const msg = { type: d.type === 'test' ? 'sale-test' : 'sale', payload: d };
    const replies = await Promise.all(clients.map((c) => ask(c, msg, 4000)));
    const played = replies.some((r) => r && r.played === true);
    await self.registration.showNotification(d.title || 'Venda aprovada!', {
      body: d.body || '',
      icon: ICON,
      badge: BADGE,
      tag: d.tag || 'pt-sale',
      renotify: true,
      silent: played,
      vibrate: played ? undefined : [180, 80, 180, 80, 320],
      timestamp: d.ts || Date.now(),
      data: { url: safeUrl(d.url) },
      actions: [{ action: 'abrir', title: 'Ver venda' }],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// O navegador renovou a inscrição (ex.: chave expirada): reinscreve e avisa o servidor.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const sub = event.newSubscription || (old && old.options ? await self.registration.pushManager.subscribe(old.options) : null);
    if (!sub) return;
    await fetch('/v1/push/subscriptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    }).catch(() => undefined);
  })());
});
