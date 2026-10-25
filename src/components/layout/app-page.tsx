'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { isDeadEndEntry, recordPathname } from '@/lib/app-nav';

// Wraps every screen and records each one visited (for the back stack and the slides). The edge
// swipe back is the phone's own: home-screen apps on iPhone get it from iOS, with the previous screen
// showing under the finger, and Android has its system back. iOS also has a swipe forward from the
// right edge, which apps don't: going back leaves a dead end ahead (see app-nav), and landing on it
// steps straight back.
export function AppPage({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    recordPathname(pathname);
  }, [pathname]);

  useEffect(() => {
    const onPopState = () => {
      if (isDeadEndEntry()) window.history.back();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-app-page>
      {children}
    </div>
  );
}
