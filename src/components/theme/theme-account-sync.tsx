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
  sameThemeSelection,
  setThemeAccentOwner,
  subscribeThemeChange,
  themeChannelForUser,
  type ThemeSelection,
} from '@/lib/theme';

const SAVE_DELAY_MS = 250;
const REFRESH_INTERVAL_MS = 10_000;
// Identifies this tab, so it ignores the live echo of its own save.
const SOURCE_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

/**
 * One theme colour per person, everywhere: home portal, attendance portal, admin portal, every
 * device and installed PWA. The colour lives on the account; each change is saved by the server and
 * pushed live to the person's other open devices. The newest change always wins, so nothing flips
 * back and forth. People who never chose a colour get Blue. Light/dark mode stays per device.
 */
export function ThemeAccountSync() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = isLoaded && isSignedIn ? user?.id ?? null : null;
  const remoteKey = JSON.stringify(user?.unsafeMetadata?.theme ?? null);
  const savedRef = useRef<ThemeSelection | null>(null);
  const userRef = useRef(user);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Applies a colour from the account only if it is newer than what this device already shows.
  const adoptRemote = useRef((remote: ThemeSelection, force: boolean) => {
    if (!savedRef.current || (remote.updatedAt || 0) >= (savedRef.current.updatedAt || 0)) savedRef.current = remote;
    // The account wins over a device colour with no timestamp (saved before timestamps existed).
    const localUpdatedAt = getThemeUpdatedAt();
    if (force || localUpdatedAt === 0 || (remote.updatedAt || 0) > localUpdatedAt) applyThemeSelection(remote);
  });

  // Saves this device's colour to the account when it differs from what the account has.
  const scheduleSave = useRef(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const local = getThemeSelection();
      const saved = savedRef.current;
      if (saved && sameThemeSelection(local, saved)) return;
      if (saved && (saved.updatedAt || 0) > (local.updatedAt || 0)) return;
      if (!local.updatedAt) return; // never push a colour this device never actually chose

      savedRef.current = local;
      try {
        const response = await fetch('/api/account/theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...local, updatedAt: local.updatedAt || Date.now(), sourceId: SOURCE_ID }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Save failed (${response.status})`);
        const stored = parseThemeSelection(body?.theme);
        if (stored && body?.stale) adoptRemote.current(stored, true);
      } catch (error) {
        savedRef.current = saved;
        console.error('Could not save theme colour to account:', error);
      }
    }, SAVE_DELAY_MS);
  });

  // Account colour on sign-in and after any refresh of the account.
  useEffect(() => {
    if (!userId) return;

    const remote = parseThemeSelection(JSON.parse(remoteKey));
    const owner = getThemeAccentOwner();
    const deviceBelongsToSomeoneElse = Boolean(owner && owner !== userId);

    if (remote) {
      adoptRemote.current(remote, deviceBelongsToSomeoneElse || !hasStoredThemeAccent());
    } else if (deviceBelongsToSomeoneElse || !hasStoredThemeAccent()) {
      // First time for this person: Blue, unless they already picked a colour on this device.
      applyThemeSelection({ ...DEFAULT_THEME_SELECTION, updatedAt: Date.now() });
    }
    setThemeAccentOwner(userId);
    scheduleSave.current();
  }, [remoteKey, userId]);

  // Save local changes (a preset tap, or releasing the wheel).
  useEffect(() => {
    if (!userId) return;
    const save = scheduleSave.current;
    const unsubscribe = subscribeThemeChange(save);
    return () => {
      unsubscribe();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [userId]);

  // Live: apply changes made on the person's other devices the moment they are saved.
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
        if (remote) adoptRemote.current(remote, false);
      };
      void channel.subscribe('theme', handler);
      cleanup = () => channel.unsubscribe('theme', handler);
    }).catch(() => {
      // Live updates unavailable: the refresh below still picks changes up when the app is reopened.
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [userId]);

  // Fallback: refresh the account when the app returns to the foreground.
  useEffect(() => {
    if (!userId) return;

    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < REFRESH_INTERVAL_MS) return;
      lastRefresh = Date.now();
      userRef.current?.reload().catch(() => {});
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
