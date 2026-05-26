const INVISIBLE_KEY_CHARS = /[\uFEFF\u200B-\u200D\u2060\s]/g;

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
