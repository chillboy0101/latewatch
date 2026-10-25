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

// Size of a portal choice card (and of any big action button meant to match it, like the
// attendance portal's check-in button).
export const CHOICE_SIZE = 'h-[86px] rounded-[22px]';
export const CHOICE_TEXT = 'text-[17.5px]';

// A portal choice: an icon tile, the name and an arrow. "large" fills the space it is given (the
// portal home's wide card on computers).
export function ChoiceCard({ highlight, href, icon, size = 'default', title }: {
  highlight?: boolean;
  href: string;
  icon: ReactNode;
  size?: 'default' | 'large';
  title: string;
}) {
  const large = size === 'large';
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center border transition-[filter] hover:brightness-105 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 active:brightness-95',
        large ? 'flex-1 gap-6 rounded-[28px] px-8' : [CHOICE_SIZE, 'gap-4 px-[18px]'],
        highlight ? 'border-primary/35 bg-gradient-to-br from-primary/30 to-primary/10' : 'border-border bg-background/40',
      )}
    >
      <span className={cn(
        'flex shrink-0 items-center justify-center',
        large ? 'h-[72px] w-[72px] rounded-[22px]' : 'h-12 w-12 rounded-2xl',
        highlight ? 'bg-primary text-primary-foreground' : 'bg-foreground/5 text-primary',
        highlight && large && 'shadow-md shadow-primary/25',
      )}>
        {icon}
      </span>
      <span className={cn('min-w-0 font-semibold leading-tight', large ? 'text-[26px] tracking-tight' : CHOICE_TEXT)}>{title}</span>
      {large ? (
        <span className={cn(
          'ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-transform group-hover:translate-x-1',
          highlight ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-border text-muted-foreground',
        )}>
          <ArrowRight className="h-5 w-5" />
        </span>
      ) : (
        <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
      )}
    </Link>
  );
}

// The rounded panel at the bottom of a phone screen, holding just the choice cards. On wider
// windows (tablets, zoomed browsers) it stays a centred column instead of stretching edge to edge.
export function ChoicePanel({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="mx-auto w-full max-w-xl rounded-t-[32px] border-t border-border bg-card px-6 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3 sm:border-x">
      <div aria-hidden className="mx-auto mb-6 h-[5px] w-10 rounded-full bg-foreground/15" />
      <nav className="grid gap-3" aria-label={label}>
        {children}
      </nav>
    </section>
  );
}
