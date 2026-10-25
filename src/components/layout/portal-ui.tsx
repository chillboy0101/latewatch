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

// The look of a choice card, shared with other big tappable rows (like the attendance portal's
// "more" sheet) so they all feel the same: raised like a button and pressed in when tapped (see the
// Button component).
export const CHOICE_PRESS = 'group flex items-center border transition-[filter,transform,box-shadow] duration-150 hover:brightness-105 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 active:translate-y-px active:scale-[0.98] active:brightness-95 motion-reduce:transition-none';
export const CHOICE_PLAIN = 'border-border bg-background/40 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_1px_3px_rgb(0_0_0/0.06)] active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.08)]';
export const CHOICE_ICON = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl';

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
        CHOICE_PRESS,
        large ? 'flex-1 gap-6 rounded-[28px] px-8' : [CHOICE_SIZE, 'gap-4 px-[18px]'],
        highlight
          ? 'border-primary/35 bg-gradient-to-br from-primary/30 to-primary/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_20px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] active:shadow-[inset_0_2px_6px_color-mix(in_oklab,var(--primary)_25%,transparent)]'
          : CHOICE_PLAIN,
      )}
    >
      <span className={cn(
        CHOICE_ICON,
        large && 'h-[72px] w-[72px] rounded-[22px]',
        highlight ? 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'bg-foreground/5 text-primary',
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
