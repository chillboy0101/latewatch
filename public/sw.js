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
      url: payload.data?.url || '/check-in',
    },
    icon: payload.icon || '/latewatch-logo.png',
    badge: '/latewatch-logo.png',
    renotify: payload.renotify === true,
    requireInteraction: payload.requireInteraction === true,
    tag: payload.tag || 'latewatch-attendance-reminder',
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
