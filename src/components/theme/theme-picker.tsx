'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyThemeAccent,
  getThemeAccent,
  getThemeAccentColor,
  getThemeCustomColor,
  normalizeHexColor,
  subscribeThemeChange,
  THEME_ACCENT_PRESETS,
} from '@/lib/theme';
import { useDismissable } from '@/components/theme/use-dismissable';

const NEUTRAL_SWATCH = 'linear-gradient(135deg, #fafafa 0 50%, #171717 50% 100%)';
const CUSTOM_SWATCH = 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)';

function Swatch({
  background,
  label,
  ringColor,
  selected,
}: {
  background: string;
  label: string;
  ringColor: string;
  selected: boolean;
}) {
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full transition-transform',
        selected ? 'scale-110 ring-2 ring-offset-2 ring-offset-card' : 'ring-1 ring-black/10 hover:scale-110 dark:ring-white/15',
      )}
      style={{ background, ...(selected ? { ['--tw-ring-color' as string]: ringColor } : {}) }}
    >
      {selected && <Check className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" strokeWidth={3} />}
    </span>
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
  const customColor = useSyncExternalStore(subscribeThemeChange, getThemeCustomColor, () => '#2563eb');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close);

  const customSelected = accent === 'custom';

  return (
    <div ref={containerRef} className="relative">
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
          className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-card"
          style={{ background: accent === 'neutral' ? NEUTRAL_SWATCH : accentColor }}
        />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Theme colour"
          className="absolute right-0 top-full z-50 mt-2 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl"
        >
          <div className="grid grid-cols-5 gap-3">
            {THEME_ACCENT_PRESETS.map(({ accent: option, label, swatch }) => (
              <button
                key={option}
                type="button"
                aria-label={label}
                aria-pressed={accent === option}
                onClick={() => applyThemeAccent(option)}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Swatch
                  background={option === 'neutral' ? NEUTRAL_SWATCH : swatch}
                  label={label}
                  ringColor={option === 'neutral' ? '#737373' : swatch}
                  selected={accent === option}
                />
              </button>
            ))}

            <label
              aria-label="Custom colour"
              className="relative cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-primary"
            >
              <Swatch
                background={customSelected ? customColor : CUSTOM_SWATCH}
                label="Custom colour"
                ringColor={customColor}
                selected={customSelected}
              />
              <input
                type="color"
                value={customColor}
                onChange={(event) => {
                  const color = normalizeHexColor(event.target.value);
                  if (color) applyThemeAccent('custom', color);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
