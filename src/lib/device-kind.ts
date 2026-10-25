// Phone or computer, judged by the device's screen rather than the browser window: a laptop with a
// narrow window or a tablet still gets the admin portal, and a phone stays a phone when turned
// sideways. Phones' short side is 320–480 CSS px; tablets start around 740 and laptops at 720+.
export const PHONE_SHORT_SIDE_MAX = 600;

export type DeviceKind = 'phone' | 'computer';

export function deviceKindForScreen(width: number, height: number): DeviceKind {
  return Math.min(width, height) < PHONE_SHORT_SIDE_MAX ? 'phone' : 'computer';
}

export function getDeviceKind(): DeviceKind {
  return deviceKindForScreen(window.screen.width, window.screen.height);
}

// Not known on the server: the layout shows a loader until the browser answers.
export function getServerDeviceKind(): DeviceKind | null {
  return null;
}

// Screen size changes with rotation or when the window moves to another monitor.
export function subscribeDeviceKind(onChange: () => void) {
  window.addEventListener('resize', onChange);
  window.screen.orientation?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.screen.orientation?.removeEventListener('change', onChange);
  };
}
