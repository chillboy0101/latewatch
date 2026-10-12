'use client';

import { useUser } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import {
  applyThemeSelection,
  DEFAULT_THEME_SELECTION,
  getThemeAccentOwner,
  getThemeSelection,
  hasStoredThemeAccent,
  parseThemeSelection,
  sameThemeSelection,
  setThemeAccentOwner,
  subscribeThemeChange,
  type ThemeSelection,
} from '@/lib/theme';

const UPLOAD_DELAY_MS = 800;
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Keeps each person's theme colour on their account (Clerk unsafeMetadata.theme), so the same
 * colour follows them to every phone, installed PWA and computer. People who never picked a colour
 * get Blue. Light/dark mode stays per device on purpose (it follows each device's own setting).
 */
export function ThemeAccountSync() {
  const { isLoaded, isSignedIn, user } = useUser();
  const syncedRef = useRef<ThemeSelection | null>(null);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const remoteTheme = user?.unsafeMetadata?.theme;

  // Pull: apply the account's colour whenever it is loaded or changes.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    const remote = parseThemeSelection(remoteTheme);
    if (remote) {
      syncedRef.current = remote;
      applyThemeSelection(remote);
    } else {
      // First sign-in since sync existed: keep a colour this person already chose on this device,
      // otherwise start them on Blue. Either way it becomes their account colour.
      const owner = getThemeAccentOwner();
      const keepLocal = hasStoredThemeAccent() && (!owner || owner === user.id);
      const initial = keepLocal ? getThemeSelection() : DEFAULT_THEME_SELECTION;
      applyThemeSelection(initial);
      syncedRef.current = null;
    }
    setThemeAccentOwner(user.id);
  }, [isLoaded, isSignedIn, remoteTheme, user]);

  // Push: save local colour changes to the account (debounced, so dragging the wheel is one save).
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      const current = userRef.current;
      if (!current) return;
      const selection = getThemeSelection();
      if (syncedRef.current && sameThemeSelection(selection, syncedRef.current)) return;

      syncedRef.current = selection;
      current.update({ unsafeMetadata: { ...current.unsafeMetadata, theme: selection } }).catch((error: unknown) => {
        syncedRef.current = null;
        console.error('Could not save theme colour to account:', error);
      });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, UPLOAD_DELAY_MS);
    };

    schedule();
    const unsubscribe = subscribeThemeChange(schedule);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [isLoaded, isSignedIn]);

  // Refresh: pick up a colour changed on another device when this app comes back to the foreground.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let lastRefresh = Date.now();
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
  }, [isLoaded, isSignedIn]);

  return null;
}
