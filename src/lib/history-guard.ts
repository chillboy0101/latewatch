/**
 * Inline script for the root layout, run before the app starts. Safari throws when a page updates
 * its history more than 100 times in 10 seconds, and that error inside a navigation broke the whole
 * screen. Past the limit an update is now skipped: the screen still changes, and updates work again
 * once the 10 seconds are up. Any other error is passed on as before. The first skip on a page is
 * reported (name HistoryLimit), so the server log shows the limit was reached and handled.
 *
 * It also counts the updates the way Safari does (recentHistoryUpdates), so the app's navigation can
 * hold a tap back before it gets to the limit (see app-nav). Safari counts in fixed 10-second spans:
 * a span starts with the first update after the last span ended, and skipped updates don't count.
 */
const RECENT_UPDATES = '__latewatchRecentHistoryUpdates';
const WINDOW_MS = 10_000;

export function buildHistoryGuardScript() {
  return `(function() {
  var reported = false;
  var spanStart = -Infinity;
  var inSpan = 0;
  window.${RECENT_UPDATES} = function () {
    return Date.now() - spanStart > ${WINDOW_MS} ? 0 : inSpan;
  };
  function report(error) {
    if (reported) return;
    reported = true;
    try {
      var body = JSON.stringify({ message: String(error.message).slice(0, 300), name: 'HistoryLimit', path: window.location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }));
    } catch (ignored) {}
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = window.history[name];
    if (typeof original !== 'function') return;
    window.history[name] = function () {
      try {
        var result = original.apply(window.history, arguments);
        var now = Date.now();
        if (now - spanStart > ${WINDOW_MS}) {
          spanStart = now;
          inSpan = 0;
        }
        inSpan += 1;
        return result;
      } catch (error) {
        if (error && error.name === 'SecurityError') {
          console.warn('History update skipped:', error.message);
          report(error);
          return undefined;
        }
        throw error;
      }
    };
  });
})();`;
}

/** History updates in Safari's current 10-second span, as counted by the guard script (0 before it runs). */
export function recentHistoryUpdates(): number {
  const count = (window as unknown as Record<string, unknown>)[RECENT_UPDATES];
  return typeof count === 'function' ? Number(count()) || 0 : 0;
}
