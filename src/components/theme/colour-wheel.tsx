'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Touch-first colour wheel: drag the knob around the hue ring and use the tone track for lighter or
// deeper shades. Built for smoothness on phones:
// - while dragging, the knob, centre preview and tone thumb are moved directly (GPU transforms) every
//   frame, with no React re-render;
// - the wheel is measured once per drag, never per move (no forced layout);
// - recolouring the whole app is the expensive part, so while the finger moves it only happens when
//   the finger pauses (and occasionally during long drags); the centre preview is always exact, and
//   the final colour is applied once on release.
// Every drag target opts out of the mobile sheet's swipe-to-close.

const SATURATION = 78;
const RING_LIGHTNESS = 50;
const MIN_TONE = 28;
const MAX_TONE = 68;
const KNOB_GAP = 8; // room around the ring so the knob and its shadow are never clipped
const PAGE_PREVIEW_IDLE_MS = 90; // recolour the app once the finger pauses this long
const PAGE_PREVIEW_MAX_WAIT_MS = 400; // and at least this often during a long continuous drag

export function hslToHex(hue: number, saturation: number, lightness: number) {
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

export function hexToHueTone(hex: string) {
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
  return { hue: Math.round(hue) % 360, tone };
}

// Drawn from the same formula as the picked colour, so the ring under the knob always matches it.
const RING_GRADIENT = `conic-gradient(from 0deg, ${Array.from({ length: 25 }, (_, index) => hslToHex(index * 15, SATURATION, RING_LIGHTNESS)).join(', ')})`;

type Kind = 'hue' | 'tone';

function toneGradient(hue: number) {
  return `linear-gradient(90deg, ${hslToHex(hue, SATURATION, MIN_TONE)}, ${hslToHex(hue, SATURATION, (MIN_TONE + MAX_TONE) / 2)}, ${hslToHex(hue, SATURATION, MAX_TONE)})`;
}

export function ColourWheel({
  value,
  selected,
  onChange,
  onPreview,
  size = 200,
}: {
  /** The colour currently applied to the app. */
  value: string;
  /** Whether the current theme is a wheel (custom) colour rather than a preset. */
  selected: boolean;
  /** Saves the colour (called once when a drag ends, or on a key press). */
  onChange: (hex: string) => void;
  /** Recolours the page live while dragging, without saving. */
  onPreview: (hex: string) => void;
  size?: number;
}) {
  const [committed, setCommitted] = useState(() => hexToHueTone(value));
  const [dragging, setDragging] = useState<Kind | null>(null);
  const [followedValue, setFollowedValue] = useState(value);
  const [lastEmitted, setLastEmitted] = useState<string | null>(null);

  const wheelRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const centreRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackFillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const live = useRef({
    hue: committed.hue,
    tone: committed.tone,
    kind: null as Kind | null,
    rect: null as DOMRect | null,
    pendingHex: null as string | null,
    previewTimer: null as ReturnType<typeof setTimeout> | null,
    maxWaitTimer: null as ReturnType<typeof setTimeout> | null,
  });
  const callbacks = useRef({ onChange, onPreview });

  useEffect(() => {
    callbacks.current = { onChange, onPreview };
  }, [onChange, onPreview]);

  // Follow colour changes made elsewhere (a preset tap, another device) without fighting a drag.
  if (!dragging && value !== followedValue) {
    setFollowedValue(value);
    if (value !== lastEmitted) setCommitted(hexToHueTone(value));
  }

  // Keep the drag model in step with the committed colour.
  useLayoutEffect(() => {
    if (live.current.kind) return;
    live.current.hue = committed.hue;
    live.current.tone = committed.tone;
  }, [committed]);

  // If the picker closes mid-drag, keep the colour that was showing instead of snapping back.
  useEffect(() => {
    const state = live.current;
    return () => {
      if (state.previewTimer) clearTimeout(state.previewTimer);
      if (state.maxWaitTimer) clearTimeout(state.maxWaitTimer);
      if (state.kind && state.pendingHex) callbacks.current.onChange(state.pendingHex);
    };
  }, []);

  const ring = Math.round(size * 0.15);
  const knob = ring + 8;
  const outer = size + KNOB_GAP * 2;
  const radius = size / 2 - ring / 2;
  const innerRadius = size / 2 - ring;

  const knobTransform = (hue: number) => {
    const radians = ((hue - 90) * Math.PI) / 180;
    const x = outer / 2 + radius * Math.cos(radians) - knob / 2;
    const y = outer / 2 + radius * Math.sin(radians) - knob / 2;
    return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  };
  const toneFraction = (tone: number) => (tone - MIN_TONE) / (MAX_TONE - MIN_TONE);

  /** Moves the picker's own visuals directly; cheap enough for every pointer move. */
  function paint(hue: number, tone: number) {
    const colour = hslToHex(hue, SATURATION, tone);
    if (knobRef.current) {
      knobRef.current.style.transform = knobTransform(hue);
      knobRef.current.style.backgroundColor = hslToHex(hue, SATURATION, RING_LIGHTNESS);
    }
    if (centreRef.current) centreRef.current.style.backgroundColor = colour;
    if (trackFillRef.current) trackFillRef.current.style.backgroundImage = toneGradient(hue);
    if (thumbRef.current) {
      thumbRef.current.style.left = `${toneFraction(tone) * 100}%`;
      thumbRef.current.style.backgroundColor = colour;
    }
  }

  /** Recolours the whole app when the finger pauses, and at least every PAGE_PREVIEW_MAX_WAIT_MS. */
  function previewPage(hex: string) {
    const state = live.current;
    state.pendingHex = hex;
    const flush = () => {
      if (state.previewTimer) clearTimeout(state.previewTimer);
      if (state.maxWaitTimer) clearTimeout(state.maxWaitTimer);
      state.previewTimer = null;
      state.maxWaitTimer = null;
      requestAnimationFrame(() => {
        if (state.kind && state.pendingHex) callbacks.current.onPreview(state.pendingHex);
      });
    };
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(flush, PAGE_PREVIEW_IDLE_MS);
    if (!state.maxWaitTimer) state.maxWaitTimer = setTimeout(flush, PAGE_PREVIEW_MAX_WAIT_MS);
  }

  function update(clientX: number, clientY: number) {
    const state = live.current;
    const rect = state.rect;
    if (!rect || !state.kind) return;

    if (state.kind === 'hue') {
      const angle = Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
      state.hue = Math.round(((angle * 180) / Math.PI + 90 + 360) % 360);
    } else {
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      state.tone = Math.round(MIN_TONE + fraction * (MAX_TONE - MIN_TONE));
    }

    paint(state.hue, state.tone);
    previewPage(hslToHex(state.hue, SATURATION, state.tone));
  }

  function commit() {
    const state = live.current;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    if (state.maxWaitTimer) clearTimeout(state.maxWaitTimer);
    state.previewTimer = null;
    state.maxWaitTimer = null;
    const hex = hslToHex(state.hue, SATURATION, state.tone);
    state.pendingHex = null;
    setCommitted({ hue: state.hue, tone: state.tone });
    setLastEmitted(hex);
    callbacks.current.onChange(hex);
  }

  function startDrag(kind: Kind, event: PointerEvent<HTMLDivElement>) {
    const rect = (kind === 'hue' ? wheelRef.current : trackRef.current)?.getBoundingClientRect() ?? null;
    if (!rect) return;

    if (kind === 'hue') {
      // Only the ring is grabbable; touching the centre preview does nothing.
      const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      if (distance < innerRadius - 6) return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    live.current.kind = kind;
    live.current.rect = rect;
    setDragging(kind);
    update(event.clientX, event.clientY);
  }

  function moveDrag(kind: Kind, event: PointerEvent<HTMLDivElement>) {
    if (live.current.kind !== kind) return;
    // Use the latest sample only; intermediate coalesced points would just repaint the same frame.
    update(event.clientX, event.clientY);
  }

  function endDrag(kind: Kind) {
    if (live.current.kind !== kind) return;
    live.current.kind = null;
    live.current.rect = null;
    setDragging(null);
    commit();
  }

  function nudge(event: KeyboardEvent<HTMLDivElement>, kind: Kind) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    if (!forward && !backward) return;
    event.preventDefault();
    const state = live.current;
    if (kind === 'hue') state.hue = (state.hue + (forward ? 1 : -1) * (event.shiftKey ? 15 : 5) + 360) % 360;
    else state.tone = Math.min(MAX_TONE, Math.max(MIN_TONE, state.tone + (forward ? 2 : -2)));
    paint(state.hue, state.tone);
    commit();
  }

  const centreColour = hslToHex(committed.hue, SATURATION, committed.tone);
  const showCheck = selected && !dragging;

  return (
    <div className="flex w-full flex-col items-center gap-4" data-vaul-no-drag>
      <div
        ref={wheelRef}
        role="slider"
        aria-label="Colour hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={committed.hue}
        tabIndex={0}
        data-vaul-no-drag
        className="relative shrink-0 touch-none select-none rounded-full outline-none [contain:layout_paint] focus-visible:ring-2 focus-visible:ring-primary"
        style={{ width: outer, height: outer }}
        onKeyDown={(event) => nudge(event, 'hue')}
        onPointerDown={(event) => startDrag('hue', event)}
        onPointerMove={(event) => moveDrag('hue', event)}
        onPointerUp={() => endDrag('hue')}
        onPointerCancel={() => endDrag('hue')}
        onLostPointerCapture={() => endDrag('hue')}
      >
        <span
          aria-hidden
          className="absolute cursor-grab rounded-full active:cursor-grabbing"
          style={{
            inset: KNOB_GAP,
            background: RING_GRADIENT,
            WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring - 1}px))`,
            mask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring - 1}px))`,
          }}
        />
        <span
          ref={centreRef}
          aria-hidden
          className={cn(
            'absolute flex items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]',
            dragging ? '' : 'transition-colors duration-300',
          )}
          style={{ inset: KNOB_GAP + ring + 12, backgroundColor: centreColour }}
        >
          <Check
            className={cn(
              'h-7 w-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-[opacity,transform] duration-200',
              showCheck ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
            strokeWidth={3}
          />
        </span>
        <span
          ref={knobRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-0 rounded-full border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] will-change-transform',
            dragging === 'hue' ? '' : 'transition-[transform,background-color] duration-300 ease-out',
          )}
          style={{
            width: knob,
            height: knob,
            transform: knobTransform(committed.hue),
            backgroundColor: hslToHex(committed.hue, SATURATION, RING_LIGHTNESS),
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
          aria-valuenow={committed.tone}
          tabIndex={0}
          data-vaul-no-drag
          className="relative h-9 cursor-pointer touch-none select-none outline-none [contain:layout_paint] focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-primary"
          onKeyDown={(event) => nudge(event, 'tone')}
          onPointerDown={(event) => startDrag('tone', event)}
          onPointerMove={(event) => moveDrag('tone', event)}
          onPointerUp={() => endDrag('tone')}
          onPointerCancel={() => endDrag('tone')}
          onLostPointerCapture={() => endDrag('tone')}
        >
          <span
            ref={trackFillRef}
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full"
            style={{ backgroundImage: toneGradient(committed.hue) }}
          />
          <span
            ref={thumbRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]',
              dragging === 'tone' ? 'scale-110' : 'transition-[left,background-color,transform] duration-300 ease-out',
            )}
            style={{ left: `${toneFraction(committed.tone) * 100}%`, backgroundColor: centreColour }}
          />
        </div>
      </div>
    </div>
  );
}
