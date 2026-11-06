'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { isAppleTouchDevice } from '@/lib/haptics';
import { recentHistoryUpdates } from '@/lib/history-guard';

// App-style navigation for the staff screens (portal home, attendance, receipts, "admin needs a
// computer"). Opening a screen slides it in from the right; going back slides it away to the right
// and the previous screen in from the left, like an iPhone app. Back buttons step back through the
// screens actually visited instead of stacking new pages on top.

const STACK_STATE = 'latewatchStack';
const DEAD_END_STATE = 'latewatchDeadEnd';
// How long the dead end stays shown before stepping back off it (see leaveDeadEnd).
const DEAD_END_SNAPSHOT_MS = 250;
// After going back, how long the screen stays before its dead end goes in (see recordPathname).
const DEAD_END_AFTER_BACK_MS = 500;
// Each screen entry's place in the history (counting up as screens open), to tell back from forward.
const INDEX_STATE = 'latewatchIndex';
const NAV_EASE_WAIT_MS = 1500;
// Most leftover same-screen entries back skips in one go (see navigateBack).
const MAX_SAME_SCREEN_SKIPS = 5;

export type NavDirection = 'forward' | 'back';

// The last few navigation steps, sent with a crash report (see client-error-report): a screen that
// breaks while someone taps quickly back and forth is a race between these steps.
const trail: string[] = [];
function note(step: string) {
  trail.push(`${Math.round(performance.now())}ms ${step}`);
  if (trail.length > 16) trail.shift();
}

export function navigationTrail() {
  return [...trail];
}

// Every tap opens its screen at once, however quick, with these exceptions:
// - While the last screen is still on its way, a tap opens nothing: it landed on the screen being
//   left, so it repeats the last one (and a second back would skip a screen). Once the new screen is
//   on the page (recordPathname), or a screen coming through the router was dropped by a move in the
//   history (handlePopState), the next tap goes straight through; a screen that never arrives stops
//   holding taps after NAV_SETTLE_MAX_MS.
// - While the step back off a dead end is on its way (stepOffDeadEnd), a tap opens nothing: the step
//   back would land after it, and Next.js drops a navigation still on its way when the history moves.
// - Safari throws past 100 history updates in 10 seconds, which broke the screen. Near that (the
//   history guard counts them as Safari does) a tap opens nothing until Safari's 10 seconds are up.
//   Taps back and forth make about 1.5 updates each, so only 6 or more a second for 10 seconds get there.
const NAV_SETTLE_MAX_MS = 1000;
// Room left under Safari's 100 for the updates a navigation and its dead end make.
const HISTORY_UPDATES_MAX = 92;
let navigationStartedAt: number | null = null;
// The screen on its way comes through the router (push or replace), not a step back in the history.
let navigationByRouter = false;
// When the step back off a dead end went out; null once it has landed (handlePopState).
let deadEndSteppingBackAt: number | null = null;
// A plain link followed while that step back was on its way: sent again once it has landed.
let resendAfterStepBack: { navigationType: 'push' | 'replace'; url: string } | null = null;
// The app's router (AppPage), for sending such a link again.
let appRouter: Router | null = null;

export function registerAppRouter(router: Router) {
  appRouter = router;
}

function cannotNavigateNow(byRouter: boolean) {
  const now = performance.now();
  if (navigationStartedAt !== null && now - navigationStartedAt < NAV_SETTLE_MAX_MS) {
    note('tap ignored (screen on its way)');
    return true;
  }
  if (deadEndSteppingBackAt !== null && now - deadEndSteppingBackAt < NAV_SETTLE_MAX_MS) {
    note('tap ignored (dead end stepping back)');
    return true;
  }
  if (recentHistoryUpdates() >= HISTORY_UPDATES_MAX) {
    note('tap ignored (history limit near)');
    return true;
  }
  navigationStartedAt = now;
  navigationByRouter = byRouter;
  navigations += 1;
  // A new screen is on its way: the dead end planned for this one, or the step back off one still
  // waiting, would only get in its way (a step back would even undo the new screen).
  cancelPendingDeadEnd();
  return false;
}

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
let currentIndex = 0;
let replaceTop = false;
let finishSlide: (() => void) | null = null;
// Screens opened from a tap so far (see cannotNavigateNow).
let navigations = 0;
// The screens left by going back are still ahead of the screen on show: it needs a dead end.
let deadEndDue = false;
let deadEndPlan: number | null = null;
let deadEndStepBack: number | null = null;

/** Called after every route change has been committed (AppPage). */
export function recordPathname(pathname: string) {
  // The screen is on the page: the next tap opens its screen straight away.
  navigationStartedAt = null;
  const own = entryStack();
  if (own && own.at(-1) === pathname) {
    // Back, forward or a reload onto a screen already visited: its entry knows the way back.
    const cameBack = own.length < currentStack.length && own.every((screen, index) => currentStack[index] === screen);
    currentStack = own;
    currentIndex = entryIndex() ?? currentIndex;
    note(`on ${pathname} (${cameBack ? 'came back' : 'revisit'})`);
    if (cameBack) planDeadEnd();
  } else {
    const left = currentStack.at(-1);
    let stack = replaceTop ? currentStack.slice(0, -1) : [...currentStack];
    if (stack.at(-1) !== pathname) stack.push(pathname);
    // The portal home is the first screen, and the sign-in screens are never gone back to: nothing
    // before them is kept, so there is no back (or back swipe) into them.
    if (pathname === '/' || (left !== undefined && isAuthScreen(left))) stack = [pathname];
    note(`on ${pathname} (${replaceTop ? 'replaced' : 'new'})`);
    currentStack = stack.slice(-50);
    if (!replaceTop) currentIndex += 1;
    window.history.replaceState({ ...window.history.state, [STACK_STATE]: currentStack, [INDEX_STATE]: currentIndex }, '');
    // A new entry drops the screens ahead. One put in another's place leaves them there, so the
    // dead end due on the screen it replaced is due on this one.
    if (replaceTop && deadEndDue) planDeadEnd();
    else cancelPendingDeadEnd();
  }
  replaceTop = false;
  // The new screen is on the page: let the slide animate to it.
  finishSlide?.();
  finishSlide = null;
}

/** The current entry's state without the dead-end mark, for an entry that takes its place. */
export function stateWithoutDeadEnd(): Record<string, unknown> {
  const state: unknown = window.history.state;
  if (!state || typeof state !== 'object') return {};
  const rest = { ...(state as Record<string, unknown>) };
  delete rest[DEAD_END_STATE];
  return rest;
}

// After going back, the screen just left is still ahead in the history, and iOS would reopen it on
// a swipe from the right edge; apps have no swipe forward. A new entry drops everything ahead of
// this screen, so put one in (a copy of this screen marked as a dead end) and step back onto this
// screen: a swipe forward can now only reach the dead end, which steps straight back (AppPage).
// The step back waits a moment so iOS has drawn the dead end (this same screen) and keeps a picture
// of it for the swipe; stepping back at once leaves it blank, and the swipe slides in a white page.
// A tap meanwhile opens its screen from the dead end, and the step back is dropped: it would land
// after the tap and undo the new screen. Once the step back has gone out, taps wait for it to land.
export function leaveDeadEnd() {
  note('dead end added');
  const navigationsBefore = navigations;
  window.history.pushState({ ...window.history.state, [DEAD_END_STATE]: true }, '');
  window.requestAnimationFrame(() => {
    if (navigations !== navigationsBefore) return;
    if (deadEndStepBack !== null) window.clearTimeout(deadEndStepBack);
    deadEndStepBack = window.setTimeout(() => {
      deadEndStepBack = null;
      // Still on the dead end (no back or new screen in the meantime): step back onto this screen.
      if (isDeadEndEntry()) stepOffDeadEnd();
    }, DEAD_END_SNAPSHOT_MS);
  });
}

// Steps back off the dead end onto its screen. The step back lands a moment later, and Next.js drops
// a navigation still on its way when the history moves: taps wait until it has landed (cannotNavigateNow).
function stepOffDeadEnd() {
  deadEndSteppingBackAt = performance.now();
  window.history.back();
}

// After going back, the dead end goes in once the screen has stayed a moment. Someone tapping
// quickly back and forth has opened the next screen by then, whose new entry drops the screens
// ahead anyway: a round trip then makes 3 history updates instead of 5, and no steps back.
function planDeadEnd() {
  if (deadEndPlan !== null) window.clearTimeout(deadEndPlan);
  deadEndDue = true;
  const screen = window.location.pathname;
  deadEndPlan = window.setTimeout(() => {
    deadEndPlan = null;
    deadEndDue = false;
    // Still on this screen, with no dead end put in meanwhile (a sheet closing adds its own).
    if (window.location.pathname === screen && !isDeadEndEntry()) leaveDeadEnd();
  }, DEAD_END_AFTER_BACK_MS);
}

/** Drops the dead end planned for this screen and any step back off one (a new entry is going in). */
export function cancelPendingDeadEnd() {
  if (deadEndPlan !== null) window.clearTimeout(deadEndPlan);
  if (deadEndStepBack !== null) window.clearTimeout(deadEndStepBack);
  deadEndPlan = null;
  deadEndStepBack = null;
  deadEndDue = false;
}

/**
 * Every router navigation as it starts (instrumentation-client.ts): the app's own taps, and plain
 * links and router calls too (the admin sidebar, the header). A dead end planned for the screen
 * being left, or the step back off one, must not land on top of it: the step back would even undo it.
 */
export function routerNavigationStarting(navigationType: 'push' | 'replace' | 'traverse', url?: string) {
  // Moves in the history come through handlePopState.
  if (navigationType === 'traverse') return;
  navigations += 1;
  // The step back off a dead end has already gone out and lands after this starts, and Next.js drops
  // a navigation when the history moves under it: send it again once the step back has landed. (The
  // app's own taps wait for it instead: see cannotNavigateNow.)
  if (deadEndSteppingBackAt !== null && url) resendAfterStepBack = { navigationType, url };
  // A screen put in another's place leaves the screens ahead: the dead end stays due (recordPathname).
  const aheadRemain = navigationType === 'replace' && deadEndDue;
  cancelPendingDeadEnd();
  deadEndDue = aheadRemain;
}

function entryIndex() {
  const state: unknown = window.history.state;
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[INDEX_STATE] : undefined;
  return typeof value === 'number' ? value : null;
}

/** Every back or forward in the history (the phone's swipes, its back button) comes through here. */
export function handlePopState() {
  note(`history moved to ${window.location.pathname}${isDeadEndEntry() ? ' (dead end)' : ''}`);
  // A step back off a dead end has landed. And a screen still coming through the router was dropped:
  // Next.js gives up a navigation when the history moves under it. Either way, taps go through again.
  deadEndSteppingBackAt = null;
  if (navigationByRouter) navigationStartedAt = null;
  // A dead end planned for a screen stays planned: it only goes in if that screen is still on show
  // (planDeadEnd), so a move that comes back to the same screen keeps it.
  // The swipe forward landed on the dead end left after going back: step straight back.
  if (isDeadEndEntry()) {
    stepOffDeadEnd();
    return;
  }
  // Back on the screen: a link followed while the step back was on its way was dropped by it. Send
  // it again, after Next.js has handled this move (its own listener runs after this one).
  if (resendAfterStepBack) {
    const { navigationType, url } = resendAfterStepBack;
    resendAfterStepBack = null;
    note(`${url} sent again (dropped by the step back)`);
    window.setTimeout(() => appRouter?.[navigationType](url), 0);
  }
  // The portal home is the first screen: anything behind it (the sign-in pages, older entries) is
  // out of reach, so a swipe back from it returns straight to it.
  const fromHome = currentStack.length === 1 && currentStack[0] === '/';
  const index = entryIndex();
  if (fromHome && (index === null || index < currentIndex)) window.history.forward();
}

/** True on the dead end left ahead of a screen after going back. */
export function isDeadEndEntry() {
  const state: unknown = window.history.state;
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[DEAD_END_STATE]);
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
// holds the old screen until the new one has rendered (or 1.5 s: a slower screen gets no slide). Browsers
// without view transitions, or with reduced motion on, just navigate. So do iPhones and iPads: iOS
// has its own swipe and slide, and Safari leaves a grey layer over screens after these slides.
export function slideTo(direction: NavDirection, navigate: () => void) {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion() || isAppleTouchDevice()) {
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
    // The new screen is slow to come: no slide (it would slide the old screen over itself); the
    // new one just appears when it is ready.
    const timer = window.setTimeout(() => {
      // Only this slide's own finish: a newer slide (a tap allowed after NAV_SETTLE_MAX_MS) may
      // have set its own meanwhile, which its screen landing must still run.
      if (finishSlide === done) finishSlide = null;
      transition.skipTransition();
      resolve();
    }, NAV_EASE_WAIT_MS);
    finishSlide = done;
    navigate();
  }));
  transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}

type Router = ReturnType<typeof useRouter>;

export function navigateForward(router: Router, href: string) {
  if (cannotNavigateNow(true)) return;
  note(`open ${href}`);
  slideTo('forward', () => router.push(href));
}

/** Opens a screen in place of this one (a dead end like "Admin needs a computer"), so back skips it. */
export function navigateReplace(router: Router, href: string) {
  const aheadRemain = deadEndDue;
  if (cannotNavigateNow(true)) return;
  // Unlike a new entry, this one leaves the screens ahead in place: its screen still needs the dead end.
  deadEndDue = aheadRemain;
  note(`open ${href} in place`);
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
  // With no earlier screen, back opens the fallback through the router.
  if (cannotNavigateNow(!canGoBack())) return;
  note(canGoBack() ? 'back' : `back to ${fallbackHref} (nothing earlier)`);
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

/**
 * To the portal home from anywhere (the admin portal's Main Portal), sliding back to it: the way the
 * portal home slid out when the admin portal opened. A step back when it is the screen before this
 * one; otherwise a new entry, which starts the stack afresh like every arrival on the portal home
 * (recordPathname).
 */
export function navigateHome(router: Router) {
  if (currentStack.at(-2) === '/') {
    navigateBack(router, '/');
    return;
  }
  if (cannotNavigateNow(true)) return;
  note('open / (home)');
  slideTo('back', () => router.push('/'));
}

export function useAppNavigation() {
  const router = useRouter();
  return useMemo(() => ({
    back: (fallbackHref: string) => navigateBack(router, fallbackHref),
    forward: (href: string) => navigateForward(router, href),
    home: () => navigateHome(router),
    replace: (href: string) => navigateReplace(router, href),
  }), [router]);
}
