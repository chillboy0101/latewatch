// A light tap of the phone's vibration motor where the browser has the vibration API (Android).
// iPhones don't; they get their haptic from the invisible switch in each button (HapticSwitch).
export function haptic() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(10);
}

// What counts as a tap worth feeling: links, buttons and button-like controls that are enabled.
const TAPPABLE = 'a[href], button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="tab"], [role="menuitem"], [role="option"], [role="switch"], input[type="color"]';

export function isTappable(target: EventTarget | null) {
  return target instanceof Element && target.closest(TAPPABLE) !== null;
}

// iPhones and iPads (iPadOS reports itself as a Mac with a touch screen).
export function isAppleTouchDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
