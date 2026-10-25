'use client';

import { useSyncExternalStore, type MouseEvent } from 'react';

// iPhones have no vibration API, and since iOS 26.5 a switch toggled from script no longer plays the
// haptic either: only a finger toggling a native switch does. So on touch devices without
// navigator.vibrate, each button and link carries an invisible native switch over its whole area.
// The tap lands on the switch (the haptic) and is then handed on to the button or link as an
// ordinary click, so links navigate, forms submit and handlers run as before.
function needsSwitchHaptics() {
  return typeof navigator.vibrate !== 'function' && window.matchMedia('(pointer: coarse)').matches;
}

const subscribe = () => () => {};

function handOnTap(event: MouseEvent<HTMLInputElement>) {
  // The switch is the click's target, so the browser would only toggle it: links wouldn't follow
  // and submit buttons wouldn't submit. Stop this click here and click the button or link itself.
  event.stopPropagation();
  const host = event.currentTarget.parentElement?.closest<HTMLElement>('a[href], button, [role="button"]');
  host?.click();
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
