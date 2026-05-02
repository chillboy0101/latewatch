'use client';

import Link from 'next/link';
import { LayoutDashboard, LogIn, Moon, Sun } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { applyThemePreference, getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';

const portals = [
  {
    description: 'Staff check-in and check-out',
    href: '/check-in',
    icon: LogIn,
    label: 'Attendance Portal',
  },
  {
    description: 'Manage staff, attendance, exports, and audits',
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Admin Portal',
  },
];

export default function Home() {
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  function toggleTheme() {
    applyThemePreference(isDark ? 'light' : 'dark');
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <Button
        variant="outline"
        size="sm"
        className="fixed right-4 top-4 z-20 h-10 gap-2 rounded-full bg-card/95 px-4 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:ring-primary/30 sm:right-6 sm:top-6"
        onClick={(event) => {
          toggleTheme();
          event.currentTarget.blur();
        }}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        <span>{isDark ? 'Light' : 'Dark'}</span>
      </Button>

      <div className="w-full max-w-3xl">
        <LateWatchLogo
          className="mb-8 justify-center"
          markSize="lg"
          subtitle="Choose a portal"
          title="LateWatch"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {portals.map((portal) => {
            const Icon = portal.icon;

            return (
              <Link
                key={portal.href}
                href={portal.href}
                className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary transition-colors group-hover:border-primary/30 group-hover:bg-primary/10">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{portal.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{portal.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
