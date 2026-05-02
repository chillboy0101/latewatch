'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createClerkAppearance } from '@/lib/clerk-appearance';
import { getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';

export function ClerkThemeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const appearance = useMemo(
    () => createClerkAppearance(isDark ? 'dark' : 'light'),
    [isDark],
  );

  return <ClerkProvider appearance={appearance}>{children}</ClerkProvider>;
}
