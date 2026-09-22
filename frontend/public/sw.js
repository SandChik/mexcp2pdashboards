/* SandChik P2P — service worker. Only job: receive Web Push and show it, and
   bring the dashboard to the front when the notification is tapped. No
   caching, no offline mode: the app must always talk to the live server. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'SandChik P2P', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'SandChik P2P';
  const opts = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: true,
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    data: { url: data.url || '/queue', type: data.type || '' },
    vibrate: data.type === 'paid' || data.type === 'newOrder' ? [200, 100, 200] : [120],
    requireInteraction: data.type === 'paid',
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/queue';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.focus(); if ('navigate' in c) await c.navigate(url); } catch { /* ignore */ } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
