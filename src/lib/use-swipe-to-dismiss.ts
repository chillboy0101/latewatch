'use client';

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/**
 * Swipe-to-dismiss for toast-style cards (touch + pointer). Dismisses on a
 * left/right fling OR an upward fling (toasts sit at the top, so swiping up
 * throws them off the top edge). Downward drags resist and spring back so they
 * don't fight page scroll. Drags that start on an interactive control are
 * ignored so taps still work; pointer capture only engages once a real drag
 * begins so it never steals a button click.
 */
export function useSwipeToDismiss(onDismiss: () => void, options?: { threshold?: number }) {
  const threshold = options?.threshold ?? 90;
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [swiping, setSwiping] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
    startRef.current = { x: event.clientX, y: event.clientY };
    draggingRef.current = true;
    setSwiping(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const x = event.clientX - startRef.current.x;
    let y = event.clientY - startRef.current.y;
    // Only upward drags dismiss; resist downward so it springs back.
    if (y > 0) y *= 0.35;
    setDrag({ x, y });
  }, []);

  const onPointerEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setSwiping(false);
    setDrag((current) => {
      const horizontal = Math.abs(current.x) >= Math.abs(current.y);
      if (horizontal && Math.abs(current.x) > threshold) {
        window.setTimeout(onDismiss, 180);
        return { x: current.x > 0 ? 600 : -600, y: current.y };
      }
      if (!horizontal && current.y < -threshold) {
        window.setTimeout(onDismiss, 180);
        return { x: current.x, y: -600 };
      }
      return { x: 0, y: 0 };
    });
  }, [onDismiss, threshold]);

  const active = swiping || drag.x !== 0 || drag.y !== 0;
  const distance = Math.max(Math.abs(drag.x), Math.max(0, -drag.y));
  const swipeStyle: CSSProperties = {
    touchAction: 'none',
    transform: active ? `translate(${drag.x}px, ${drag.y}px)` : undefined,
    opacity: drag.x !== 0 || drag.y !== 0 ? Math.max(1 - distance / 240, 0.2) : undefined,
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
