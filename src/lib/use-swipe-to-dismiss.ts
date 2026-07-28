'use client';

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/**
 * Swipe-left/right to dismiss for toast-style cards (touch + pointer). A short
 * horizontal fling throws the card off-screen and fires `onDismiss`; under the
 * threshold it springs back. Vertical drags are ignored (`touch-action: pan-y`)
 * so the page can still scroll. Drags that start on an interactive control are
 * ignored so taps still work; the drag state resets after a fling so a reused
 * instance shows the next message correctly.
 */
export function useSwipeToDismiss(onDismiss: () => void, options?: { threshold?: number }) {
  const threshold = options?.threshold ?? 55;
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const draggingRef = useRef(false);

  const applyDrag = useCallback((value: number) => {
    dragXRef.current = value;
    setDragX(value);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
    startXRef.current = event.clientX;
    draggingRef.current = true;
    setSwiping(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    applyDrag(event.clientX - startXRef.current);
  }, [applyDrag]);

  const onPointerEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setSwiping(false);

    if (Math.abs(dragXRef.current) > threshold) {
      applyDrag(dragXRef.current > 0 ? 600 : -600);
      window.setTimeout(onDismiss, 160);
      // Reset a reused instance (e.g. the single status toast) so the next
      // message isn't rendered still flung off-screen.
      window.setTimeout(() => applyDrag(0), 220);
      return;
    }

    applyDrag(0);
  }, [applyDrag, onDismiss, threshold]);

  const swipeStyle: CSSProperties = {
    touchAction: 'pan-y',
    transform: swiping || dragX !== 0 ? `translateX(${dragX}px)` : undefined,
    opacity: dragX !== 0 ? Math.max(1 - Math.abs(dragX) / 200, 0.15) : undefined,
    transition: swiping ? 'none' : 'transform 200ms ease, opacity 200ms ease',
  };

  const swipeHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };

  return { swipeHandlers, swipeStyle };
}
