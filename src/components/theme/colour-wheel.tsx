'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Touch-first colour wheel: drag the knob around the hue ring and use the tone track for lighter or
// deeper shades. Drawn by the app (not the native picker) so it looks and behaves the same on phones,
// installed PWAs and desktops. Every drag target opts out of the mobile sheet's swipe-to-close.

const SATURATION = 78;
const MIN_TONE = 28;
const MAX_TONE = 68;
const KNOB_GAP = 8; // room around the ring so the knob and its shadow are never clipped

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const value = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function hexToHueTone(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  if (max !== min) {
    const delta = max - min;
    if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
    else if (max === green) hue = ((blue - red) / delta + 2) * 60;
    else hue = ((red - green) / delta + 4) * 60;
  }
  const tone = Math.min(MAX_TONE, Math.max(MIN_TONE, Math.round(((max + min) / 2) * 100)));
  return { hue: Math.round(hue), tone };
}

function useFrameEmitter(onChange: (hex: string) => void) {
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // At most one theme update per animation frame while dragging keeps the whole app smooth.
  return useCallback((hex: string) => {
    pendingRef.current = hex;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) onChange(pendingRef.current);
    });
  }, [onChange]);
}

export function ColourWheel({
  value,
  selected,
  onChange,
  size = 200,
}: {
  /** The colour currently applied to the app. */
  value: string;
  /** Whether the current theme is a wheel (custom) colour rather than a preset. */
  selected: boolean;
  onChange: (hex: string) => void;
  size?: number;
}) {
  const [hue, setHue] = useState(() => hexToHueTone(value).hue);
  const [tone, setTone] = useState(() => hexToHueTone(value).tone);
  const [dragging, setDragging] = useState<'hue' | 'tone' | null>(null);
  const [lastEmitted, setLastEmitted] = useState<string | null>(null);
  const [followedValue, setFollowedValue] = useState(value);
  const wheelRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const emitFrame = useFrameEmitter(onChange);

  // Follow colour changes made elsewhere (a preset tap, another device) without fighting a drag.
  if (!dragging && value !== followedValue) {
    setFollowedValue(value);
    if (value !== lastEmitted) {
      const next = hexToHueTone(value);
      setHue(next.hue);
      setTone(next.tone);
    }
  }

  const emit = (nextHue: number, nextTone: number) => {
    const hex = hslToHex(nextHue, SATURATION, nextTone);
    setLastEmitted(hex);
    emitFrame(hex);
  };

  const ring = Math.round(size * 0.15);
  const knob = ring + 8;
  const outer = size + KNOB_GAP * 2;
  const radius = size / 2 - ring / 2;
  const radians = ((hue - 90) * Math.PI) / 180;
  const knobX = outer / 2 + radius * Math.cos(radians);
  const knobY = outer / 2 + radius * Math.sin(radians);
  const toneFraction = (tone - MIN_TONE) / (MAX_TONE - MIN_TONE);

  function hueFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const angle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
    const nextHue = Math.round(((angle * 180) / Math.PI + 90 + 360) % 360);
    setHue(nextHue);
    emit(nextHue, tone);
  }

  function toneFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const nextTone = Math.round(MIN_TONE + fraction * (MAX_TONE - MIN_TONE));
    setTone(nextTone);
    emit(hue, nextTone);
  }

  function nudge(event: KeyboardEvent<HTMLDivElement>, kind: 'hue' | 'tone') {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    if (!forward && !backward) return;
    event.preventDefault();
    if (kind === 'hue') {
      const nextHue = (hue + (forward ? 1 : -1) * (event.shiftKey ? 15 : 5) + 360) % 360;
      setHue(nextHue);
      emit(nextHue, tone);
    } else {
      const nextTone = Math.min(MAX_TONE, Math.max(MIN_TONE, tone + (forward ? 2 : -2)));
      setTone(nextTone);
      emit(hue, nextTone);
    }
  }

  function startDrag(kind: 'hue' | 'tone', event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(kind);
    if (kind === 'hue') hueFromPointer(event);
    else toneFromPointer(event);
  }

  const stopDrag = () => setDragging(null);

  return (
    <div className="flex w-full flex-col items-center gap-4" data-vaul-no-drag>
      <div
        ref={wheelRef}
        role="slider"
        aria-label="Colour hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={hue}
        tabIndex={0}
        data-vaul-no-drag
        className="relative shrink-0 cursor-grab touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
        style={{ width: outer, height: outer }}
        onKeyDown={(event) => nudge(event, 'hue')}
        onPointerDown={(event) => startDrag('hue', event)}
        onPointerMove={(event) => {
          if (dragging === 'hue') hueFromPointer(event);
        }}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
      >
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            inset: KNOB_GAP,
            background: 'conic-gradient(from 0deg, hsl(0 78% 50%), hsl(45 85% 50%), hsl(90 70% 45%), hsl(150 70% 42%), hsl(195 80% 45%), hsl(240 75% 58%), hsl(285 70% 55%), hsl(330 78% 52%), hsl(360 78% 50%))',
            WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring - 1}px))`,
            mask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring - 1}px))`,
          }}
        />
        <span
          aria-hidden
          className="absolute flex items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-[background-color,transform] duration-200"
          style={{ inset: KNOB_GAP + ring + 12, background: value, transform: dragging ? 'scale(1.04)' : undefined }}
        >
          {selected && <Check className="h-7 w-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={3} />}
        </span>
        <span
          aria-hidden
          className={cn(
            'absolute rounded-full border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]',
            dragging === 'hue' ? 'scale-110' : 'transition-[left,top,transform] duration-200 ease-out',
          )}
          style={{
            width: knob,
            height: knob,
            left: knobX - knob / 2,
            top: knobY - knob / 2,
            background: hslToHex(hue, SATURATION, 50),
          }}
        />
      </div>

      {/* Tone track: padded so the thumb is never clipped at either end. */}
      <div className="w-full px-3" style={{ maxWidth: outer + 24 }}>
        <div
          ref={trackRef}
          role="slider"
          aria-label="Colour tone"
          aria-valuemin={MIN_TONE}
          aria-valuemax={MAX_TONE}
          aria-valuenow={tone}
          tabIndex={0}
          data-vaul-no-drag
          className="relative h-8 cursor-pointer touch-none select-none outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-primary"
          onKeyDown={(event) => nudge(event, 'tone')}
          onPointerDown={(event) => startDrag('tone', event)}
          onPointerMove={(event) => {
            if (dragging === 'tone') toneFromPointer(event);
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full"
            style={{ background: `linear-gradient(90deg, ${hslToHex(hue, SATURATION, MIN_TONE)}, ${hslToHex(hue, SATURATION, (MIN_TONE + MAX_TONE) / 2)}, ${hslToHex(hue, SATURATION, MAX_TONE)})` }}
          />
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]',
              dragging === 'tone' ? 'scale-110' : 'transition-[left,transform] duration-200 ease-out',
            )}
            style={{ left: `${toneFraction * 100}%`, background: hslToHex(hue, SATURATION, tone) }}
          />
        </div>
      </div>
    </div>
  );
}
