// Phone or computer, judged by the device rather than the browser window: a laptop with a narrow
// window or a tablet still gets the admin portal, and a phone stays a phone when turned sideways.
// A phone is a touch-first device (coarse pointer) whose screen's short side is under 600 CSS px
// (phones are 320–480; tablets start around 740). The pointer check keeps small or zoomed laptop
// screens (1280×720 at 125% is 1024×576) from being taken for phones.
export const PHONE_SHORT_SIDE_MAX = 600;

// The portal home's wide card needs at least this much window width.
export const WIDE_HOME_MIN_WIDTH = 1024;

export type DeviceKind = 'phone' | 'computer';
export type HomeView = 'compact' | 'wide';

export function deviceKindFor({ coarsePointer, height, width }: { coarsePointer: boolean; height: number; width: number }): DeviceKind {
  return coarsePointer && Math.min(width, height) < PHONE_SHORT_SIDE_MAX ? 'phone' : 'computer';
}

export function getDeviceKind(): DeviceKind {
  return deviceKindFor({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    height: window.screen.height,
    width: window.screen.width,
  });
}

// Not known on the server: the layout shows a loader until the browser answers.
export function getServerDeviceKind(): DeviceKind | null {
  return null;
}

// Portal home: phones always get the compact layout; other devices get the wide card when the
// window is wide enough for it.
export function homeViewFor(kind: DeviceKind, windowWidth: number): HomeView {
  return kind === 'phone' || windowWidth < WIDE_HOME_MIN_WIDTH ? 'compact' : 'wide';
}

export function getHomeView(): HomeView {
  return homeViewFor(getDeviceKind(), window.innerWidth);
}

export function getServerHomeView(): HomeView | null {
  return null;
}

// Screen and window size change with rotation, resizing, or moving to another monitor.
export function subscribeDeviceKind(onChange: () => void) {
  window.addEventListener('resize', onChange);
  window.screen.orientation?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.screen.orientation?.removeEventListener('change', onChange);
  };
}
