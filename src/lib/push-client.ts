const INVISIBLE_KEY_CHARS = /[\uFEFF\u200B-\u200D\u2060\s]/g;
const PUSH_SERVICE_UNAVAILABLE_MESSAGE = 'This browser could not connect to its push notification service. Open LateWatch in Chrome, Edge, or Safari, or enable Brave push messaging and try again.';

export function normalizeVapidPublicKey(value: string) {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(INVISIBLE_KEY_CHARS, '')
    .replace(/=+$/g, '');
}

export function vapidPublicKeyToUint8Array(value: string) {
  const publicKey = normalizeVapidPublicKey(value);

  if (!/^[A-Za-z0-9_-]+$/.test(publicKey)) {
    throw new Error('Reminder setup key is invalid. Refresh this page and try again.');
  }

  const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = `${publicKey}${padding}`.replace(/-/g, '+').replace(/_/g, '/');

  try {
    const rawData = globalThis.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  } catch {
    throw new Error('Reminder setup key is invalid. Refresh this page and try again.');
  }
}

export function pushSubscriptionErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '';
  const normalizedMessage = message.toLowerCase();

  if (name === 'AbortError' && normalizedMessage.includes('push service')) {
    return PUSH_SERVICE_UNAVAILABLE_MESSAGE;
  }

  if (normalizedMessage.includes('registration failed') && normalizedMessage.includes('push service')) {
    return PUSH_SERVICE_UNAVAILABLE_MESSAGE;
  }

  return message || 'Could not update reminders';
}
