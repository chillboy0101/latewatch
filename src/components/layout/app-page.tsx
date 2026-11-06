'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { handlePopState, recordPathname, registerAppRouter, useAppNavigation } from '@/lib/app-nav';
import { takeEarlyTap } from '@/lib/early-taps';

// Wraps every screen and records each one visited (for the back stack and the slides). The edge
// swipe back is the phone's own: home-screen apps on iPhone get it from iOS, with the previous screen
// showing under the finger, and Android has its system back. iOS also has a swipe forward from the
// right edge, which apps don't: going back leaves a dead end ahead (see app-nav), and landing on it
// steps straight back. A swipe back from the portal home (the first screen) returns to it.
export function AppPage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const navigation = useAppNavigation();

  useEffect(() => {
    registerAppRouter(router);
  }, [router]);

  useEffect(() => {
    recordPathname(pathname);
  }, [pathname]);

  // The app is up: a tap made while it was starting (held by the early-tap script) opens its screen
  // now, in place, instead of loading the whole page again. After recordPathname, so this screen is
  // on the back stack first.
  useEffect(() => {
    const tap = takeEarlyTap();
    if (!tap) return;
    if (tap.nav === 'back') navigation.back(tap.href);
    else if (tap.nav === 'replace') navigation.replace(tap.href);
    else navigation.forward(tap.href);
  }, [navigation]);

  useEffect(() => {
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-app-page>
      {children}
    </div>
  );
}
