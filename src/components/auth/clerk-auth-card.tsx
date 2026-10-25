'use client';

import { SignIn, SignUp, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createClerkAppearance } from '@/lib/clerk-appearance';
import { getIsDarkTheme, getThemePrimaryColor, subscribeThemeChange } from '@/lib/theme';

type ClerkAuthCardProps = {
  mode: 'sign-in' | 'sign-up';
};

// How long to wait for a step forward before going to the portal home instead.
const FORWARD_WAIT_MS = 400;

export function ClerkAuthCard({ mode }: ClerkAuthCardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  // Signed in already when the page opened (not by signing in on it just now).
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean | null>(null);
  if (isLoaded && arrivedSignedIn === null) setArrivedSignedIn(Boolean(isSignedIn));
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

  useEffect(() => {
    if (!arrivedSignedIn) return;
    // Already signed in, so this page was reached by going back past the portal home (the first
    // screen). Step forward to where the swipe started instead of showing the portal home twice.
    window.history.forward();
    const timer = window.setTimeout(() => router.replace('/'), FORWARD_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [arrivedSignedIn, router]);

  if (arrivedSignedIn) return null;

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
