'use client';

// Pieces shared by the stand-alone portal screens (portal home, "admin needs a computer"): the
// theme and mode buttons, the big choice cards and the bottom panel that holds them.

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ModePicker } from '@/components/theme/mode-picker';
import { ThemePicker } from '@/components/theme/theme-picker';
import { getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';
import { cn } from '@/lib/utils';

// These screens have no admin header, so each applies light/dark mode itself.
export function useApplyDarkMode() {
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);
}

// Solid round buttons: the plain background has nothing for a glass blur to show through.
const pickerButton = 'h-10 w-10 rounded-full border border-border bg-card shadow-sm';

export function PortalPickers() {
  return (
    <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <ThemePicker buttonClassName={pickerButton} iconClassName="h-5 w-5" />
      <ModePicker buttonClassName={pickerButton} />
    </header>
  );
}

export function ChoiceCard({ highlight, href, icon, title }: {
  highlight?: boolean;
  href: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex h-[86px] items-center gap-4 rounded-[22px] border px-[18px] transition-[filter] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:brightness-95',
        highlight ? 'border-primary/35 bg-gradient-to-br from-primary/30 to-primary/10' : 'border-border bg-background/40',
      )}
    >
      <span className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
        highlight ? 'bg-primary text-primary-foreground' : 'bg-foreground/5 text-primary',
      )}>
        {icon}
      </span>
      <span className="min-w-0 text-[17.5px] font-semibold leading-tight">{title}</span>
      <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// The rounded panel at the bottom of a phone screen, holding just the choice cards.
export function ChoicePanel({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="rounded-t-[32px] border-t border-border bg-card px-6 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3">
      <div aria-hidden className="mx-auto mb-6 h-[5px] w-10 rounded-full bg-foreground/15" />
      <nav className="grid gap-3" aria-label={label}>
        {children}
      </nav>
    </section>
  );
}
