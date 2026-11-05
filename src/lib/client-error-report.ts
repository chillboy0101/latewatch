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
    // Every field capped, so a report is a few KB at most and always fits a beacon (64 KiB).
    const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
    const body = JSON.stringify({
      digest: clip(error?.digest, 100),
      historyLength: window.history.length,
      message: clip(String(error?.message ?? error), 1000),
      name: clip(error?.name, 100),
      path: clip(window.location.pathname, 300),
      stack: typeof error?.stack === 'string' ? clip(error.stack.split('\n').slice(0, 12).join('\n'), 4000) : undefined,
      trail: navigationTrail().map((step) => step.slice(0, 120)),
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

const RELOADED_AT_KEY = 'latewatch-crash-reloaded-at';
const RELOAD_AGAIN_AFTER_MS = 30_000;

/**
 * Whether the crash screen may reload the page now. Only when this reload's time is saved:
 * without it, a screen that keeps breaking would reload over and over. No storage, or a reload a
 * moment ago (30 s): stay on the choices.
 */
export function mayReloadAfterCrash() {
  try {
    const storage = window.sessionStorage;
    if (Date.now() - Number(storage.getItem(RELOADED_AT_KEY) || 0) < RELOAD_AGAIN_AFTER_MS) return false;
    const now = String(Date.now());
    storage.setItem(RELOADED_AT_KEY, now);
    return storage.getItem(RELOADED_AT_KEY) === now;
  } catch {
    return false;
  }
}
