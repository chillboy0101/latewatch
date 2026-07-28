const STATIC_CACHE = 'latewatch-static-v1';
const STATIC_ASSET_RE = /\.(?:js|css|woff2?|png|jpe?g|svg|ico|webp)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)));
    await clients.claim();
  })());
});

// Runtime cache for static assets only. Navigations, RSC fetches (?_rsc=), and
// /api/* always go to the network so nothing dynamic is ever served stale.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHashedStatic = url.pathname.startsWith('/_next/static/');
  const isStaticAsset = STATIC_ASSET_RE.test(url.pathname);
  if (!isHashedStatic && !isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);

    if (cached) {
      // Hashed assets are immutable (URL changes when content changes), so serve
      // from cache with no revalidation. Other static files use SWR.
      if (!isHashedStatic) {
        event.waitUntil(
          fetch(request)
            .then((response) => { if (response.ok) cache.put(request, response.clone()); })
            .catch(() => {}),
        );
      }
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});

function reportPushDeliveryReceipt(deliveryId) {
  if (!deliveryId) return Promise.resolve();

  return fetch('/api/attendance/reminders/delivery-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryId }),
    keepalive: true,
  }).catch(() => {});
}

function broadcastReminderToClients(message) {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
    for (const client of windowClients) {
      client.postMessage(message);
    }
  }).catch(() => {});
}

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'LateWatch reminder';
  const options = {
    body: payload.body || 'Open LateWatch to update your attendance.',
    data: {
      deliveryId: payload.data?.deliveryId || null,
      reminderType: payload.data?.reminderType || 'reminder',
      url: payload.data?.url || '/check-in',
    },
    icon: payload.icon || '/latewatch-logo.png',
    badge: '/latewatch-logo.png',
    renotify: payload.renotify === true,
    requireInteraction: payload.requireInteraction === true,
    tag: payload.tag || 'latewatch-attendance-reminder',
  };

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    reportPushDeliveryReceipt(payload.data?.deliveryId),
    // Mirror the reminder inside any open tab, so staff see it in-app too
    // (foreground pushes are often suppressed by the OS).
    broadcastReminderToClients({
      type: 'latewatch-push-reminder',
      title,
      body: options.body,
      url: options.data.url,
      tag: options.tag,
    }),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const targetUrl = event.notification.data?.url || '/check-in';
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windowClients) {
      if (client.url.includes(targetUrl) && 'focus' in client) {
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
