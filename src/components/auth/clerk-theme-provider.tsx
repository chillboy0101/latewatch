'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createClerkAppearance } from '@/lib/clerk-appearance';
import { getIsDarkTheme, getThemePrimaryColor, subscribeThemeChange } from '@/lib/theme';

export function ClerkThemeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const primaryColor = useSyncExternalStore(subscribeThemeChange, () => getThemePrimaryColor(getIsDarkTheme()), () => undefined);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const appearance = useMemo(
    () => createClerkAppearance(isDark ? 'dark' : 'light', primaryColor),
    [isDark, primaryColor],
  );

  return <ClerkProvider appearance={appearance}>{children}</ClerkProvider>;
}
