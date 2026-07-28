self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

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
