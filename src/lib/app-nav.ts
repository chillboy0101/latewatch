'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

// App-style navigation for the staff screens (portal home, attendance, receipts, "admin needs a
// computer"). Opening a screen slides it in from the right; going back slides it away to the right
// and the previous screen in from the left, like an iPhone app. Back buttons step back through the
// screens actually visited instead of stacking new pages on top.

const STACK_STATE = 'latewatchStack';
const NAV_EASE_WAIT_MS = 1500;
// Most leftover same-screen entries back skips in one go (see navigateBack).
const MAX_SAME_SCREEN_SKIPS = 5;

export type NavDirection = 'forward' | 'back' | 'swipe-back';

// The screens leading to this one, oldest first, kept on the browser history entry itself. So the
// way back always matches the real history, through reloads, relaunches and the Android back button
// (a list kept anywhere else can drift, and back would then land on the same screen).
function entryStack(): string[] | null {
  const state: unknown = window.history.state;
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[STACK_STATE] : undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

const isAuthScreen = (pathname: string) => pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

let currentStack: string[] = [];
let replaceTop = false;
let finishSlide: (() => void) | null = null;

/** Called after every route change has been committed (AppPage). */
export function recordPathname(pathname: string) {
  const own = entryStack();
  if (own && own.at(-1) === pathname) {
    // Back, forward or a reload onto a screen already visited: its entry knows the way back.
    currentStack = own;
  } else {
    const left = currentStack.at(-1);
    let stack = replaceTop ? currentStack.slice(0, -1) : [...currentStack];
    if (stack.at(-1) !== pathname) stack.push(pathname);
    // The portal home is the first screen, and the sign-in screens are never gone back to: nothing
    // before them is kept, so there is no back (or back swipe) into them.
    if (pathname === '/' || (left !== undefined && isAuthScreen(left))) stack = [pathname];
    currentStack = stack.slice(-50);
    window.history.replaceState({ ...window.history.state, [STACK_STATE]: currentStack }, '');
  }
  replaceTop = false;
  // The new screen is on the page: let the slide animate to it.
  finishSlide?.();
  finishSlide = null;
}

/** True when there is an earlier screen from this session to go back to. */
export function canGoBack() {
  return currentStack.length > 1;
}

/** Where back leads when the app was opened straight on a screen (no earlier screen to return to). */
export function parentPath(pathname: string) {
  if (pathname === '/' || isAuthScreen(pathname)) return null;
  if (pathname.startsWith('/check-in/')) return '/check-in';
  return '/';
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Runs a navigation inside a view transition so the old and new screens can slide. The transition
// holds the old screen until the new one has rendered (or 1.5 s, for a slow screen). Browsers
// without view transitions, or with reduced motion on, just navigate.
export function slideTo(direction: NavDirection, navigate: () => void) {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    navigate();
    return;
  }

  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = document.startViewTransition(() => new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, NAV_EASE_WAIT_MS);
    finishSlide = done;
    navigate();
  }));
  transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}

type Router = ReturnType<typeof useRouter>;

export function navigateForward(router: Router, href: string) {
  slideTo('forward', () => router.push(href));
}

/** Opens a screen in place of this one (a dead end like "Admin needs a computer"), so back skips it. */
export function navigateReplace(router: Router, href: string) {
  replaceTop = true;
  slideTo('forward', () => router.replace(href));
}

// A leftover entry for the screen being left (a sheet's, say) would make back show the same screen
// again: keep going back past such entries to the previous screen.
function skipSameScreenEntries() {
  const leaving = window.location.pathname;
  let skips = 0;
  const stop = () => {
    window.removeEventListener('popstate', onPopState);
    window.clearTimeout(timer);
  };
  const onPopState = () => {
    const sheetOpen = document.querySelector('[role="dialog"]') !== null;
    if (window.location.pathname === leaving && !sheetOpen && skips < MAX_SAME_SCREEN_SKIPS) {
      skips += 1;
      window.history.back();
      return;
    }
    stop();
  };
  // Back that goes nowhere (no earlier entry) fires no popstate: stop listening after a moment.
  const timer = window.setTimeout(stop, 3000);
  window.addEventListener('popstate', onPopState);
}

/** Back to the previous screen; with none (the app was opened here), to `fallbackHref`. */
export function navigateBack(router: Router, fallbackHref: string, direction: NavDirection = 'back') {
  if (canGoBack()) {
    slideTo(direction, () => {
      skipSameScreenEntries();
      window.history.back();
    });
    return;
  }
  replaceTop = true;
  slideTo(direction, () => router.replace(fallbackHref));
}

// A link click that should be handled by the app (not a new tab, a download or a modified click).
export function isPlainClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function useAppNavigation() {
  const router = useRouter();
  return useMemo(() => ({
    back: (fallbackHref: string) => navigateBack(router, fallbackHref),
    forward: (href: string) => navigateForward(router, href),
    replace: (href: string) => navigateReplace(router, href),
  }), [router]);
}
