'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { applyThemeAccent, applyThemePreference, getIsDarkTheme, getThemeAccent, getThemePreference, subscribeThemeChange, type ThemePreference } from '@/lib/theme';
import { useDismissable } from '@/components/theme/use-dismissable';

const MODES: Array<{ icon: typeof Sun; label: string; value: ThemePreference }> = [
  { icon: Sun, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
  { icon: Monitor, label: 'System', value: 'system' },
];

export function ModePicker({
  buttonClassName,
  buttonVariant = 'ghost',
  iconClassName = 'h-5 w-5',
}: {
  buttonClassName?: string;
  buttonVariant?: 'ghost' | 'glass';
  iconClassName?: string;
}) {
  const preference = useSyncExternalStore(subscribeThemeChange, getThemePreference, () => 'system');
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const accent = useSyncExternalStore(subscribeThemeChange, getThemeAccent, () => 'blue');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close);

  const ButtonIcon = preference === 'system' ? Monitor : isDark ? Moon : Sun;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant={buttonVariant}
        size="icon"
        className={buttonClassName}
        onClick={() => setOpen((value) => !value)}
        title="Appearance"
        aria-label="Appearance"
        aria-expanded={open}
      >
        <ButtonIcon className={iconClassName} />
      </Button>

      {open && (
        <div role="menu" aria-label="Appearance" className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-border bg-card p-1 text-card-foreground shadow-xl">
          {MODES.map(({ icon: Icon, label, value }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              onClick={() => {
                applyThemePreference(value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                preference === value ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1 text-left">{label}</span>
              {preference === value && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
          {/* Back to the standard blue after picking a colour with the theme colour button. */}
          {accent !== 'blue' && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  applyThemeAccent('blue');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="flex-1 text-left">Default colour</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
