'use client';

import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { isAppleTouchDevice } from '@/lib/haptics';
import { cn } from '@/lib/utils';

// iPhones have no working vibration API, and since iOS 26.5 a switch toggled from script no longer
// plays the haptic either: only a finger toggling a native switch does. So on iPhones (and other
// touch devices without navigator.vibrate), each button and link carries an invisible native switch
// over its whole area. The tap lands on the switch (the haptic) and is then handed on to the button
// or link as an ordinary click, so links navigate, forms submit and handlers run as before.

// iPhones and iPads are detected directly, as newer iOS versions may expose a navigator.vibrate
// that does nothing.
function needsSwitchHaptics() {
  return isAppleTouchDevice() || (typeof navigator.vibrate !== 'function' && window.matchMedia('(pointer: coarse)').matches);
}

const subscribe = () => () => {};

function handOnTap(event: MouseEvent<HTMLInputElement>) {
  // The switch is the click's target, so the browser would only toggle it: links wouldn't follow
  // and submit buttons wouldn't submit. Stop this click here and click the button or link itself.
  event.stopPropagation();
  const parent = event.currentTarget.parentElement;
  const host = parent?.closest<HTMLElement>('a[href], button, [role="button"]')
    ?? parent?.closest('[data-haptic-host]')?.querySelector<HTMLElement>('button, input:not(.haptic-switch)');
  // A colour input opens its picker on this click (on iPhones only a click opens it).
  host?.click();
}

// For a control drawn by someone else (the account button): the switch sits over it and hands the
// tap on to the button or input inside.
export function HapticHost({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-flex', className)} data-haptic-host>
      {children}
      <HapticSwitch />
    </span>
  );
}

export function HapticSwitch() {
  const enabled = useSyncExternalStore(subscribe, needsSwitchHaptics, () => false);
  if (!enabled) return null;

  return (
    <input
      aria-hidden
      className="haptic-switch"
      onClick={handOnTap}
      ref={(element) => element?.setAttribute('switch', '')}
      tabIndex={-1}
      type="checkbox"
    />
  );
}
