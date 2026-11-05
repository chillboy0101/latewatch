'use client';

import { navigationTrail } from '@/lib/app-nav';

/**
 * Sends what broke a screen to the server log: errors that only happen on someone's phone can't
 * be seen any other way. Best effort, and it never throws (the page is already in trouble).
 */
const reported = new WeakSet<object>();

export function reportClientError(error: Error & { digest?: string }) {
  try {
    // Once per error, however often the screen showing it re-runs.
    if (error && typeof error === 'object') {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const body = JSON.stringify({
      digest: error.digest,
      historyLength: window.history.length,
      message: String(error?.message ?? error),
      name: error?.name,
      path: window.location.pathname,
      stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 12).join('\n') : undefined,
      trail: navigationTrail(),
    });
    // A beacon still goes out when the page reloads straight after (as the crash screen does).
    const sent = typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }));
    if (!sent) {
      void fetch('/api/client-errors', { body, headers: { 'Content-Type': 'application/json' }, keepalive: true, method: 'POST' }).catch(() => {});
    }
  } catch {
    // Reporting must never cause a second error.
  }
}
