// A light tap of the phone's vibration motor. Android browsers have navigator.vibrate. iOS Safari
// has no vibration API, but toggling a switch control (<input type="checkbox" switch>, iOS 17.4+)
// plays the system haptic, so a hidden one is clicked instead. Must run inside a user gesture
// (a click handler); does nothing on devices without a motor.
export function haptic() {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(10);
    return;
  }

  const label = document.createElement('label');
  label.ariaHidden = 'true';
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  label.remove();
}

// What counts as a tap worth feeling: links, buttons and button-like controls that are enabled.
const TAPPABLE = 'a[href], button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="tab"], [role="menuitem"], [role="option"], [role="switch"]';

export function isTappable(target: EventTarget | null) {
  return target instanceof Element && target.closest(TAPPABLE) !== null;
}
