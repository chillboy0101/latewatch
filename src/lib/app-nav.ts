'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

// App-style navigation for the staff screens (portal home, attendance, receipts, "admin needs a
// computer"). Opening a screen slides it in from the right; going back slides it away to the right
// and the previous screen in from the left, like an iPhone app. Back buttons step back through the
// screens actually visited instead of stacking new pages on top.

const STACK_KEY = 'latewatch-nav-stack';
// Screens left by going back, most recent last: a swipe from the right edge reopens them.
const FORWARD_KEY = 'latewatch-nav-forward';
const NAV_EASE_WAIT_MS = 1500;

export type NavDirection = 'forward' | 'back' | 'swipe-back' | 'swipe-forward';

// The screens visited in this app session, oldest first. Kept in sessionStorage so a reload keeps it.
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(list.slice(-50)));
  } catch {
    // Storage blocked: back buttons fall back to each screen's parent; no forward swipe.
  }
}

const readStack = () => readList(STACK_KEY);

const isAuthScreen = (pathname: string) => pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

let replaceTop = false;
let finishSlide: (() => void) | null = null;

/** Called after every route change has been committed (NavigationTracker). */
export function recordPathname(pathname: string) {
  const stack = readStack();
  const forward = readList(FORWARD_KEY);
  const left = stack.at(-1);
  if (replaceTop && left !== undefined) {
    // Back with no earlier screen (went to the parent instead): the screen left can be reopened.
    if (left !== pathname) forward.push(left);
    stack[stack.length - 1] = pathname;
  } else if (stack.at(-2) === pathname) {
    // Back: remember the screen left so a swipe from the right edge can reopen it.
    if (left !== undefined) forward.push(left);
    stack.pop();
  } else if (left !== pathname) {
    stack.push(pathname);
    // Reopening the screen just left keeps the rest of the way forward; any other screen starts a
    // new path, like a browser's forward history.
    if (forward.at(-1) === pathname) forward.pop();
    else forward.length = 0;
  }
  // The portal home is the first screen, and the sign-in screens are never gone back to: nothing
  // before them is kept, so there is no back (or back swipe) into them.
  if (pathname === '/' || (left !== undefined && isAuthScreen(left))) stack.splice(0, stack.length - 1);
  replaceTop = false;
  writeList(STACK_KEY, stack);
  writeList(FORWARD_KEY, forward);
  // The new screen is on the page: let the slide animate to it.
  finishSlide?.();
  finishSlide = null;
}

/** True when there is an earlier screen from this session to go back to. */
export function canGoBack() {
  return readStack().length > 1;
}

/** The screen most recently left by going back, if any: where a swipe from the right edge leads. */
export function forwardPath() {
  return readList(FORWARD_KEY).at(-1) ?? null;
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

/** Reopens the screen most recently left by going back (the swipe from the right edge). */
export function navigateToForward(router: Router) {
  const href = forwardPath();
  if (href) slideTo('swipe-forward', () => router.push(href));
}

/** Back to the previous screen; with none (the app was opened here), to `fallbackHref`. */
export function navigateBack(router: Router, fallbackHref: string, direction: NavDirection = 'back') {
  if (canGoBack()) {
    slideTo(direction, () => window.history.back());
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
  }), [router]);
}
