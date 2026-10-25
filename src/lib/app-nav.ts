'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

// App-style navigation for the staff screens (portal home, attendance, receipts, "admin needs a
// computer"). Opening a screen slides it in from the right; going back slides it away to the right
// and the previous screen in from the left, like an iPhone app. Back buttons step back through the
// screens actually visited instead of stacking new pages on top.

const STACK_KEY = 'latewatch-nav-stack';
const NAV_EASE_WAIT_MS = 1500;

export type NavDirection = 'forward' | 'back' | 'swipe-back';

// The screens visited in this app session, oldest first. Kept in sessionStorage so a reload keeps it.
function readStack(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-50)));
  } catch {
    // Storage blocked: back buttons fall back to each screen's parent.
  }
}

let replaceTop = false;
let finishSlide: (() => void) | null = null;

/** Called after every route change has been committed (NavigationTracker). */
export function recordPathname(pathname: string) {
  const stack = readStack();
  if (replaceTop && stack.length > 0) stack[stack.length - 1] = pathname;
  else if (stack.at(-2) === pathname) stack.pop();
  else if (stack.at(-1) !== pathname) stack.push(pathname);
  replaceTop = false;
  writeStack(stack);
  // The new screen is on the page: let the slide animate to it.
  finishSlide?.();
  finishSlide = null;
}

/** True when there is an earlier screen from this session to go back to. */
export function canGoBack() {
  return readStack().length > 1;
}

/** Where back leads when the app was opened straight on a screen (no earlier screen to return to). */
export function parentPath(pathname: string) {
  if (pathname === '/') return null;
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
