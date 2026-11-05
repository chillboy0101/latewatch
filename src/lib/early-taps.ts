/**
 * Inline script for the root layout, run before the app starts. Until the app has started, its
 * links are plain links: a tap on one loads the whole page again, which on a phone takes a second or
 * more (the portal home's Admin Portal, tapped as soon as it shows). Such a tap is held and handed to
 * the app as soon as it is up (AppPage), which opens the screen in place. If the app isn't up within
 * EARLY_TAP_FALLBACK_MS, the link opens the plain way after all.
 */
const PENDING = '__latewatchEarlyTap';
const READY = '__latewatchAppReady';
export const EARLY_TAP_FALLBACK_MS = 4000;

export type EarlyTap = { href: string; nav: 'forward' | 'replace' | 'back' };

export function buildEarlyTapScript() {
  return `(function() {
  document.addEventListener('click', function (event) {
    if (window.${READY} || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download')) return;
    var url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
    event.preventDefault();
    var tap = { href: url.pathname + url.search + url.hash, nav: link.getAttribute('data-nav') || 'forward', url: url.href };
    window.${PENDING} = tap;
    setTimeout(function () {
      if (!window.${READY} && window.${PENDING} === tap) window.location.assign(tap.url);
    }, ${EARLY_TAP_FALLBACK_MS});
  }, true);
})();`;
}

/** Marks the app as up (later taps are its own) and returns a tap made before it was, once. */
export function takeEarlyTap(): EarlyTap | null {
  const state = window as unknown as Record<string, unknown>;
  state[READY] = true;
  const tap = state[PENDING] as { href?: unknown; nav?: unknown } | undefined;
  delete state[PENDING];
  // A path on this site only ("//host" would leave it).
  if (!tap || typeof tap.href !== 'string' || !tap.href.startsWith('/') || tap.href.startsWith('//')) return null;
  return { href: tap.href, nav: tap.nav === 'replace' || tap.nav === 'back' ? tap.nav : 'forward' };
}
