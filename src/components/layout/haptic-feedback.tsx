'use client';

import { useEffect } from 'react';
import { haptic, isTappable } from '@/lib/haptics';

// A light haptic tap on phones whenever a link, button or tab is pressed, across the whole app.
// Only on touch screens: laptops have no motor to drive.
export function HapticFeedback() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const handleClick = (event: MouseEvent) => {
      if (event.isTrusted && isTappable(event.target)) haptic();
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}
