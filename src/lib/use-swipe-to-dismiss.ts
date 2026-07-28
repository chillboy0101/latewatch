'use client';

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/**
 * Swipe-left/right to dismiss for toast-style cards (touch + pointer).
 * Drags that start on an interactive control are ignored so taps still work;
 * pointer capture only engages once a real drag begins so it never steals a
 * button click. Past the threshold the card flings off-screen and `onDismiss`
 * fires; under it, it springs back.
 */
export function useSwipeToDismiss(onDismiss: () => void, options?: { threshold?: number }) {
  const threshold = options?.threshold ?? 90;
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
    startXRef.current = event.clientX;
    draggingRef.current = true;
    setSwiping(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    setDragX(event.clientX - startXRef.current);
  }, []);

  const onPointerEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setSwiping(false);
    setDragX((current) => {
      if (Math.abs(current) > threshold) {
        window.setTimeout(onDismiss, 180);
        return current > 0 ? 600 : -600;
      }
      return 0;
    });
  }, [onDismiss, threshold]);

  const swipeStyle: CSSProperties = {
    touchAction: 'pan-y',
    transform: swiping || dragX !== 0 ? `translateX(${dragX}px)` : undefined,
    opacity: dragX !== 0 ? Math.max(1 - Math.abs(dragX) / 240, 0.2) : undefined,
    transition: swiping ? 'none' : 'transform 220ms ease, opacity 220ms ease',
  };

  const swipeHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };

  return { swipeHandlers, swipeStyle };
}
