'use client';

// Pieces shared by the stand-alone portal screens (portal home, "admin needs a computer"): the
// theme and mode buttons, the big choice cards and the bottom panel that holds them.

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ModePicker } from '@/components/theme/mode-picker';
import { ThemePicker } from '@/components/theme/theme-picker';
import { PRESS, RAISED_SOLID } from '@/components/ui/button';
import { HapticSwitch } from '@/components/ui/haptic-switch';
import { isPlainClick, useAppNavigation } from '@/lib/app-nav';
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
// "more" sheet) so they all feel the same: raised like a button and pressed in smoothly when tapped
// (see the Button component).
export const CHOICE_PRESS = cn(PRESS, 'group relative flex items-center border hover:brightness-105 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 active:brightness-95');
export const CHOICE_PLAIN = 'border-border bg-background/40 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_1px_3px_rgb(0_0_0/0.06)] active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.08)]';
export const CHOICE_ICON = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl';

// A portal choice: an icon tile, the name and an arrow. The highlighted one is solid in the theme
// colour, like the attendance portal's check-in button; the others stay plain. "large" fills the space it is given (the
// portal home's wide card on computers). Opening it slides the screen in; a "back" card (like
// Portal Home from the admin redirect) steps back to the previous screen instead, and a "replace"
// card opens its screen in place of this one, so back skips this screen.
export function ChoiceCard({ back, highlight, href, icon, replace, size = 'default', title }: {
  back?: boolean;
  highlight?: boolean;
  href: string;
  icon: ReactNode;
  replace?: boolean;
  size?: 'default' | 'large';
  title: string;
}) {
  const navigation = useAppNavigation();
  const large = size === 'large';
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        if (back) navigation.back(href);
        else if (replace) navigation.replace(href);
        else navigation.forward(href);
      }}
      className={cn(
        CHOICE_PRESS,
        large ? 'flex-1 gap-6 rounded-[28px] px-8' : [CHOICE_SIZE, 'gap-4 px-[18px]'],
        highlight
          ? cn('border-primary bg-primary text-primary-foreground hover:bg-primary/90', RAISED_SOLID)
          : CHOICE_PLAIN,
      )}
    >
      <span className={cn(
        CHOICE_ICON,
        large && 'h-[72px] w-[72px] rounded-[22px]',
        highlight ? 'bg-white/15 text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'bg-foreground/5 text-primary',
      )}>
        {icon}
      </span>
      <span className={cn('min-w-0 font-semibold leading-tight', large ? 'text-[26px] tracking-tight' : CHOICE_TEXT)}>{title}</span>
      {large ? (
        <span className={cn(
          'ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-transform group-hover:translate-x-1',
          highlight ? 'border-white/25 bg-white/10 text-primary-foreground' : 'border-border text-muted-foreground',
        )}>
          <ArrowRight className="h-5 w-5" />
        </span>
      ) : (
        <ArrowRight className={cn('ml-auto h-5 w-5 shrink-0', highlight ? 'text-primary-foreground/80' : 'text-muted-foreground')} />
      )}
      <HapticSwitch />
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
