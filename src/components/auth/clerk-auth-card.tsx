'use client';

import { SignIn, SignUp } from '@clerk/nextjs';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createClerkAppearance } from '@/lib/clerk-appearance';
import { getIsDarkTheme, getThemePrimaryColor, subscribeThemeChange } from '@/lib/theme';

type ClerkAuthCardProps = {
  mode: 'sign-in' | 'sign-up';
};

export function ClerkAuthCard({ mode }: ClerkAuthCardProps) {
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const primaryColor = useSyncExternalStore(subscribeThemeChange, () => getThemePrimaryColor(getIsDarkTheme()), () => undefined);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const appearance = useMemo(
    () => createClerkAppearance(isDark ? 'dark' : 'light', primaryColor),
    [isDark, primaryColor],
  );
  const inviteOnlySignInAppearance = useMemo(
    () => ({
      ...appearance,
      elements: {
        ...appearance.elements,
        footerAction: 'hidden',
      },
    }),
    [appearance],
  );

  if (mode === 'sign-up') {
    return (
      <SignUp
        key={isDark ? 'dark-sign-up' : 'light-sign-up'}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
        appearance={appearance}
      />
    );
  }

  return (
    <SignIn
      key={isDark ? 'dark-sign-in' : 'light-sign-in'}
      routing="path"
      path="/sign-in"
      fallbackRedirectUrl="/"
      transferable={false}
      withSignUp={false}
      appearance={inviteOnlySignInAppearance}
    />
  );
}
