'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import {
  applyThemeAccent,
  getThemeAccent,
  getThemeAccentColor,
  previewThemeAccentColor,
  subscribeThemeChange,
  THEME_ACCENT_PRESETS,
} from '@/lib/theme';
import { ColourWheel } from '@/components/theme/colour-wheel';
import { useDismissable } from '@/components/theme/use-dismissable';

const NEUTRAL_SWATCH = 'linear-gradient(135deg, #fafafa 0 50%, #171717 50% 100%)';
const PHONE_QUERY = '(max-width: 639px)';

function subscribePhone(callback: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function Swatch({ background, ringColor, selected }: { background: string; ringColor: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 sm:h-8 sm:w-8',
        selected ? 'scale-110 ring-2 ring-offset-2 ring-offset-card' : 'ring-1 ring-black/10 hover:scale-110 active:scale-95 dark:ring-white/15',
      )}
      style={{ background, ...(selected ? { ['--tw-ring-color' as string]: ringColor } : {}) }}
    >
      {selected && <Check className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" strokeWidth={3} />}
    </span>
  );
}

function ColourPanel({ wheelSize }: { wheelSize: number }) {
  const accent = useSyncExternalStore(subscribeThemeChange, getThemeAccent, () => 'blue');
  const accentColor = useSyncExternalStore(subscribeThemeChange, getThemeAccentColor, () => '#2563eb');

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="grid grid-cols-[repeat(6,2.5rem)] gap-2.5 sm:grid-cols-[repeat(6,2rem)] sm:gap-2">
        {THEME_ACCENT_PRESETS.map(({ accent: option, label, swatch }) => (
          <button
            key={option}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={accent === option}
            onClick={() => applyThemeAccent(option)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Swatch
              background={option === 'neutral' ? NEUTRAL_SWATCH : swatch}
              ringColor={option === 'neutral' ? '#737373' : swatch}
              selected={accent === option}
            />
          </button>
        ))}
      </div>

      <ColourWheel
        size={wheelSize}
        value={accentColor}
        selected={accent === 'custom'}
        onChange={(hex) => applyThemeAccent('custom', hex)}
        onPreview={previewThemeAccentColor}
      />
    </div>
  );
}

export function ThemePicker({
  buttonClassName,
  buttonVariant = 'ghost',
  iconClassName = 'h-4 w-4',
}: {
  buttonClassName?: string;
  buttonVariant?: 'ghost' | 'glass';
  iconClassName?: string;
}) {
  const accent = useSyncExternalStore(subscribeThemeChange, getThemeAccent, () => 'blue');
  const accentColor = useSyncExternalStore(subscribeThemeChange, getThemeAccentColor, () => '#2563eb');
  const isPhone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open && !isPhone, containerRef, close);

  const trigger = (
    <Button
      type="button"
      variant={buttonVariant}
      size="icon"
      className={cn('relative', buttonClassName)}
      onClick={() => setOpen((value) => !value)}
      title="Theme colour"
      aria-label="Theme colour"
      aria-expanded={open}
    >
      <Palette className={iconClassName} />
      <span
        aria-hidden
        className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-card transition-colors duration-300"
        style={{ background: accent === 'neutral' ? NEUTRAL_SWATCH : accentColor }}
      />
    </Button>
  );

  if (isPhone) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent aria-describedby={undefined} style={{ backgroundColor: 'var(--card)', backdropFilter: 'none' }}>
            <DrawerTitle className="sr-only">Theme colour</DrawerTitle>
            <div className="max-h-[80dvh] overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
              <ColourPanel wheelSize={208} />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {trigger}
      {open && (
        <div
          role="dialog"
          aria-label="Theme colour"
          className="absolute right-0 top-full z-50 mt-2 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xl"
        >
          <ColourPanel wheelSize={176} />
        </div>
      )}
    </div>
  );
}
