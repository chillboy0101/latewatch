'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyThemeAccent,
  applyThemePreference,
  getThemeAccent,
  getThemeCustomColor,
  getThemePreference,
  normalizeHexColor,
  subscribeThemeChange,
  THEME_ACCENT_PRESETS,
  type ThemePreference,
} from '@/lib/theme';

const MODE_OPTIONS: Array<{ icon: typeof Sun; label: string; value: ThemePreference }> = [
  { icon: Sun, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
  { icon: Monitor, label: 'System', value: 'system' },
];

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
  const customColor = useSyncExternalStore(subscribeThemeChange, getThemeCustomColor, () => '#2563eb');
  const preference = useSyncExternalStore(subscribeThemeChange, getThemePreference, () => 'system');
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // pointerdown covers mouse, touch and pen, so a tap anywhere outside closes the picker.
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    setHexDraft(customColor);
    setOpen((value) => !value);
  }

  function applyCustom(value: string) {
    const color = normalizeHexColor(value);
    if (color) applyThemeAccent('custom', color);
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant={buttonVariant}
        size="icon"
        className={buttonClassName}
        onClick={toggleOpen}
        title="Choose theme"
        aria-label="Choose theme"
        aria-expanded={open}
      >
        <Palette className={iconClassName} />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Theme"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mode</p>
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1">
            {MODE_OPTIONS.map(({ icon: Icon, label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => applyThemePreference(value)}
                aria-pressed={preference === value}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  preference === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Colour</p>
          <div className="grid grid-cols-4 gap-2">
            {THEME_ACCENT_PRESETS.map(({ accent: option, label, swatch }) => {
              const selected = accent === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => applyThemeAccent(option)}
                  aria-pressed={selected}
                  title={label}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-black/10 dark:ring-white/20"
                    style={{
                      background: option === 'neutral'
                        ? 'linear-gradient(135deg, #fafafa 0 50%, #171717 50% 100%)'
                        : swatch,
                    }}
                  >
                    {selected && (
                      <Check className={cn('h-4 w-4', option === 'neutral' ? 'text-primary mix-blend-difference' : 'text-white')} />
                    )}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>

          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Custom colour</p>
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border p-2',
              accent === 'custom' ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <input
              type="color"
              aria-label="Pick a custom colour"
              value={normalizeHexColor(hexDraft) || customColor}
              onChange={(event) => {
                setHexDraft(event.target.value);
                applyCustom(event.target.value);
              }}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            />
            <input
              type="text"
              aria-label="Custom colour hex code"
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              placeholder="#2563eb"
              onChange={(event) => {
                const value = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`;
                setHexDraft(value);
                applyCustom(value);
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm uppercase outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {accent === 'custom' && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Applies across every page. Very light or dark picks are adjusted so text stays readable.
          </p>
        </div>
      )}
    </div>
  );
}
