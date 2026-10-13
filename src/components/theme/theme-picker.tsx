'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Palette, Pipette } from 'lucide-react';
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

const NATIVE_SAVE_DELAY_MS = 400;
const COARSE_QUERY = '(pointer: coarse)';
const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

function subscribeCoarse(callback: () => void) {
  const media = window.matchMedia(COARSE_QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

type EyeDropperWindow = Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };

/**
 * "More colours" for an exact colour. Phones and tablets get the device's own colour sheet (it looks
 * native there). Computers get an in-panel field instead of the browser's boxy popup: type or paste a
 * hex code, or pick any colour on screen with the eyedropper where the browser supports it.
 */
function MoreColours({ value }: { value: string }) {
  const isTouch = useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE_QUERY).matches, () => false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value.replace('#', '').toUpperCase());
  const [editing, setEditing] = useState(false);
  const canPickFromScreen = typeof window !== 'undefined' && Boolean((window as EyeDropperWindow).EyeDropper);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Show the current colour unless the person is typing.
  const shownText = editing ? text : value.replace('#', '').toUpperCase();

  function previewAndSave(hex: string) {
    previewThemeAccentColor(hex);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => applyThemeAccent('custom', hex), NATIVE_SAVE_DELAY_MS);
  }

  if (isTouch) {
    return (
      <label
        data-vaul-no-drag
        className="relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-primary hover:bg-foreground/5 hover:text-foreground"
      >
        <Pipette className="h-4 w-4" />
        More colours
        <input
          type="color"
          aria-label="More colours"
          value={value}
          onChange={(event) => previewAndSave(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Pipette className="h-4 w-4" />
        More colours
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span aria-hidden className="h-9 w-9 shrink-0 rounded-md ring-1 ring-black/10 dark:ring-white/15" style={{ background: value }} />
      <label className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-border bg-background px-2.5 font-mono text-sm focus-within:ring-2 focus-within:ring-primary">
        <span className="text-muted-foreground">#</span>
        <input
          autoFocus
          aria-label="Hex colour"
          spellCheck={false}
          maxLength={7}
          value={shownText}
          onFocus={() => {
            setText(value.replace('#', '').toUpperCase());
            setEditing(true);
          }}
          onBlur={() => setEditing(false)}
          onChange={(event) => {
            const next = event.target.value.replace('#', '').toUpperCase();
            setText(next);
            const match = HEX_PATTERN.exec(next);
            if (match) previewAndSave(`#${match[1].toLowerCase()}`);
          }}
          className="w-full min-w-0 bg-transparent pl-0.5 uppercase outline-none"
        />
      </label>
      {canPickFromScreen && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          title="Pick a colour from the screen"
          aria-label="Pick a colour from the screen"
          onClick={async () => {
            try {
              const Picker = (window as EyeDropperWindow).EyeDropper!;
              const { sRGBHex } = await new Picker().open();
              const match = HEX_PATTERN.exec(sRGBHex);
              if (match) {
                if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                applyThemeAccent('custom', `#${match[1].toLowerCase()}`);
              }
            } catch {
              // Cancelled with Escape: keep the current colour.
            }
          }}
        >
          <Pipette className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

const LIVE_SHARE_INTERVAL_MS = 250;

function ColourPanel({ wheelSize }: { wheelSize: number }) {
  const accent = useSyncExternalStore(subscribeThemeChange, getThemeAccent, () => 'blue');
  const accentColor = useSyncExternalStore(subscribeThemeChange, getThemeAccentColor, () => '#2563eb');
  const shareRef = useRef<{ lastAt: number; timer: ReturnType<typeof setTimeout> | null; hex: string | null }>({ lastAt: 0, timer: null, hex: null });

  useEffect(() => {
    const share = shareRef.current;
    return () => {
      if (share.timer) clearTimeout(share.timer);
    };
  }, []);

  // Live while dragging: recolour this page every frame, and share the colour with the person's
  // other devices a few times a second so they follow the drag too.
  const previewLive = useCallback((hex: string) => {
    previewThemeAccentColor(hex);
    const share = shareRef.current;
    share.hex = hex;
    if (share.timer) return;
    const wait = Math.max(0, LIVE_SHARE_INTERVAL_MS - (Date.now() - share.lastAt));
    share.timer = setTimeout(() => {
      share.timer = null;
      share.lastAt = Date.now();
      if (share.hex) applyThemeAccent('custom', share.hex);
    }, wait);
  }, []);

  const commitColour = useCallback((hex: string) => {
    const share = shareRef.current;
    if (share.timer) clearTimeout(share.timer);
    share.timer = null;
    share.hex = null;
    applyThemeAccent('custom', hex);
  }, []);

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
        onChange={commitColour}
        onPreview={previewLive}
      />

      <MoreColours value={accentColor} />
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
