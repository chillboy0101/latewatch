'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Palette } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { HapticSwitch } from '@/components/ui/haptic-switch';
import { cn } from '@/lib/utils';
import {
  applyThemeAccent,
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_COLOR,
  getThemeAccent,
  getThemeAccentColor,
  previewThemeAccentColor,
  subscribeThemeChange,
} from '@/lib/theme';

const NEUTRAL_SWATCH = 'linear-gradient(135deg, #fafafa 0 50%, #171717 50% 100%)';
const LIVE_SHARE_INTERVAL_MS = 250;

/**
 * The theme colour button opens the device's own colour picker directly (phone sheet, Mac colour
 * panel, browser picker on Windows). Any colour works: the theme keeps text readable whatever is
 * picked. "Reset to blue" in the appearance menu goes back to the standard blue.
 */
export function ThemePicker({
  buttonClassName,
  buttonVariant = 'ghost',
  iconClassName = 'h-4 w-4',
}: {
  buttonClassName?: string;
  buttonVariant?: 'ghost' | 'glass';
  iconClassName?: string;
}) {
  const accent = useSyncExternalStore(subscribeThemeChange, getThemeAccent, () => DEFAULT_ACCENT);
  const accentColor = useSyncExternalStore(subscribeThemeChange, getThemeAccentColor, () => DEFAULT_ACCENT_COLOR);
  const shareRef = useRef<{ lastAt: number; timer: ReturnType<typeof setTimeout> | null; hex: string | null }>({ lastAt: 0, timer: null, hex: null });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const share = shareRef.current;
    return () => {
      if (share.timer) clearTimeout(share.timer);
    };
  }, []);

  // While the picker is open: recolour this page at once, and share the colour with the person's
  // other devices a few times a second so they follow along.
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

  // The input is uncontrolled so the picker is never reset mid-choice; it follows colour changes
  // made elsewhere (another device, Reset to blue). React's onChange fires on every movement, so
  // the final colour is saved from the browser's own "change" event, sent when the picker closes.
  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== accentColor) input.value = accentColor;
  }, [accentColor]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleChange = () => commitColour(input.value);
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, [commitColour]);

  return (
    <label
      data-haptic-host
      title="Theme colour"
      className={cn(
        buttonVariants({ size: 'icon', variant: buttonVariant }),
        'relative cursor-pointer focus-within:ring-2 focus-within:ring-primary',
        buttonClassName,
      )}
    >
      <Palette className={iconClassName} />
      <span
        aria-hidden
        className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-card"
        style={{ background: accent === 'neutral' ? NEUTRAL_SWATCH : accentColor }}
      />
      <input
        ref={inputRef}
        type="color"
        aria-label="Theme colour"
        defaultValue={accentColor}
        onChange={(event) => previewLive(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <HapticSwitch />
    </label>
  );
}
