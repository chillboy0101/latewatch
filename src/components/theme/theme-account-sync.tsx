'use client';

import { useUser } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import { getAblyRealtime } from '@/lib/ably-browser';
import {
  applyThemeSelection,
  DEFAULT_THEME_SELECTION,
  getThemeAccentOwner,
  getThemeSelection,
  getThemeUpdatedAt,
  hasStoredThemeAccent,
  parseThemeSelection,
  setThemeAccentOwner,
  subscribeThemeUserChange,
  themeChannelForUser,
  type ThemeSelection,
} from '@/lib/theme';

const SAVE_DELAY_MS = 200;
const REFRESH_INTERVAL_MS = 10_000;
// Identifies this tab, so it ignores the live echo of its own save.
const SOURCE_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

async function fetchAccountTheme(): Promise<ThemeSelection | null | undefined> {
  try {
    const response = await fetch('/api/account/theme', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => null);
    return parseThemeSelection(body?.theme);
  } catch {
    return undefined;
  }
}

async function saveAccountTheme(selection: ThemeSelection) {
  const response = await fetch('/api/account/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, sourceId: SOURCE_ID }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Save failed (${response.status})`);
  return { stale: body?.stale === true, theme: parseThemeSelection(body?.theme) };
}

/** Applies an account colour if it is newer than this device's (or this device never chose one). */
function adopt(remote: ThemeSelection, force = false) {
  const localUpdatedAt = getThemeUpdatedAt();
  if (force || localUpdatedAt === 0 || (remote.updatedAt || 0) > localUpdatedAt) applyThemeSelection(remote);
}

/**
 * One theme colour per person, everywhere: home portal, attendance portal, admin portal, every
 * device and installed PWA. The colour is stored on the server; a device saves only when the person
 * on it picks a colour, and every save is pushed live to their other open devices. The newest choice
 * always wins, so colours never flip back and forth. First-time users get Blue. Light/dark mode
 * stays per device.
 */
export function ThemeAccountSync() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = isLoaded && isSignedIn ? user?.id ?? null : null;
  const legacyTheme = useRef<unknown>(null);
  const legacyValue = user?.unsafeMetadata?.theme ?? null;

  // A colour saved to the account by the previous version, used once to seed the new store.
  useEffect(() => {
    legacyTheme.current = legacyValue;
  }, [legacyValue]);

  // Load the account colour on sign-in; first time, adopt a legacy/local choice or default to Blue.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const remote = await fetchAccountTheme();
      if (cancelled || remote === undefined) return;

      const owner = getThemeAccentOwner();
      const deviceBelongsToSomeoneElse = Boolean(owner && owner !== userId);
      setThemeAccentOwner(userId);

      if (remote) {
        adopt(remote, deviceBelongsToSomeoneElse);
        return;
      }

      // Nothing stored yet for this person.
      const legacy = parseThemeSelection(legacyTheme.current);
      const local = getThemeSelection();
      const initial = legacy
        ? { ...legacy, updatedAt: legacy.updatedAt || Date.now() }
        : !deviceBelongsToSomeoneElse && hasStoredThemeAccent()
          ? { ...local, updatedAt: local.updatedAt || Date.now() }
          : { ...DEFAULT_THEME_SELECTION, updatedAt: Date.now() };
      applyThemeSelection(initial);
      await saveAccountTheme(initial).catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Save only when the person on this device picks a colour.
  useEffect(() => {
    if (!userId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeThemeUserChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const selection = getThemeSelection();
        try {
          const result = await saveAccountTheme(selection);
          if (result.stale && result.theme) adopt(result.theme, true);
        } catch (error) {
          console.error('Could not save theme colour to account:', error);
        }
      }, SAVE_DELAY_MS);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  // Live: apply a colour picked on another device the moment it is saved.
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void getAblyRealtime().then((ably) => {
      if (cancelled) return;
      const channel = ably.channels.get(`latewatch:${themeChannelForUser(userId)}`);
      const handler = (message: { data?: unknown }) => {
        const data = message.data as { sourceId?: unknown; theme?: unknown } | null;
        if (!data || data.sourceId === SOURCE_ID) return;
        const remote = parseThemeSelection(data.theme);
        if (remote) adopt(remote);
      };
      void channel.subscribe('theme', handler);
      cleanup = () => channel.unsubscribe('theme', handler);
    }).catch(() => {
      // Live updates unavailable: the foreground refresh below still catches up.
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [userId]);

  // Fallback: catch up when the app returns to the foreground (e.g. a phone that was asleep).
  useEffect(() => {
    if (!userId) return;

    let lastRefresh = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < REFRESH_INTERVAL_MS) return;
      lastRefresh = Date.now();
      void fetchAccountTheme().then((remote) => {
        if (remote) adopt(remote);
      });
    };

    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [userId]);

  return null;
}
