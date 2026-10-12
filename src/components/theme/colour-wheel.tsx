'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// A touch-first colour wheel: drag the knob around the hue ring and use the tone slider for
// lighter/deeper shades. Works the same on phones, installed PWAs and desktops (no native picker).

const SATURATION = 78;
const MIN_TONE = 28;
const MAX_TONE = 68;

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
  const lightness = (max + min) / 2;
  let hue = 0;
  if (max !== min) {
    const delta = max - min;
    if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
    else if (max === green) hue = ((blue - red) / delta + 2) * 60;
    else hue = ((red - green) / delta + 4) * 60;
  }
  const tone = Math.min(MAX_TONE, Math.max(MIN_TONE, Math.round(lightness * 100)));
  return { hue: Math.round(hue), tone };
}

export function ColourWheel({
  value,
  onChange,
  size = 200,
}: {
  value: string;
  onChange: (hex: string) => void;
  size?: number;
}) {
  const initial = hexToHueTone(value);
  const [hue, setHue] = useState(initial.hue);
  const [tone, setTone] = useState(initial.tone);
  const [dragging, setDragging] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);

  const colour = hslToHex(hue, SATURATION, tone);

  // Apply at most once per animation frame while dragging so the whole app recolours smoothly.
  const emit = useCallback((hex: string) => {
    pendingRef.current = hex;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) onChange(pendingRef.current);
    });
  }, [onChange]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  function updateFromPointer(clientX: number, clientY: number) {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const angle = Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
    const nextHue = Math.round(((angle * 180) / Math.PI + 90 + 360) % 360);
    setHue(nextHue);
    emit(hslToHex(nextHue, SATURATION, tone));
  }

  const ring = Math.round(size * 0.16);
  const radius = size / 2 - ring / 2;
  const radians = ((hue - 90) * Math.PI) / 180;
  const knobX = size / 2 + radius * Math.cos(radians);
  const knobY = size / 2 + radius * Math.sin(radians);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={wheelRef}
        role="slider"
        aria-label="Colour hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={hue}
        tabIndex={0}
        className="relative shrink-0 cursor-grab touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card active:cursor-grabbing"
        style={{ width: size, height: size }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging) updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 15 : 5;
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const nextHue = (hue + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : -step) + 360) % 360;
          setHue(nextHue);
          emit(hslToHex(nextHue, SATURATION, tone));
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, hsl(0 78% 50%), hsl(60 78% 50%), hsl(120 78% 45%), hsl(180 78% 45%), hsl(240 78% 55%), hsl(300 78% 50%), hsl(360 78% 50%))',
            WebkitMask: `radial-gradient(circle, transparent ${size / 2 - ring}px, #000 ${size / 2 - ring + 1}px)`,
            mask: `radial-gradient(circle, transparent ${size / 2 - ring}px, #000 ${size / 2 - ring + 1}px)`,
          }}
        />
        <span
          aria-hidden
          className="absolute rounded-full shadow-inner transition-colors duration-150"
          style={{
            inset: ring + 14,
            background: colour,
          }}
        />
        <span
          aria-hidden
          className={cn(
            'absolute rounded-full border-[3px] border-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
            dragging ? 'scale-125' : 'transition-[left,top,transform] duration-200 ease-out',
          )}
          style={{
            width: ring + 6,
            height: ring + 6,
            left: knobX - (ring + 6) / 2,
            top: knobY - (ring + 6) / 2,
            background: hslToHex(hue, SATURATION, 50),
          }}
        />
      </div>

      <input
        type="range"
        aria-label="Colour tone"
        min={MIN_TONE}
        max={MAX_TONE}
        value={tone}
        onChange={(event) => {
          const nextTone = Number(event.target.value);
          setTone(nextTone);
          emit(hslToHex(hue, SATURATION, nextTone));
        }}
        className="colour-tone-slider w-full"
        style={{
          background: `linear-gradient(90deg, ${hslToHex(hue, SATURATION, MIN_TONE)}, ${hslToHex(hue, SATURATION, MAX_TONE)})`,
          maxWidth: size + 24,
        }}
      />
    </div>
  );
}
