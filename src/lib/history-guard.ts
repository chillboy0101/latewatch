/**
 * Inline script for the root layout, run before the app starts. Safari throws when a page updates
 * its history more than 100 times in 10 seconds (about 60 quick taps between two screens), and
 * that error inside a navigation broke the whole screen. Past the limit an update is now skipped:
 * the screen still changes, and updates work again once the 10 seconds are up. Any other error is
 * passed on as before. The first skip on a page is reported (name HistoryLimit), so the server log
 * shows the limit was reached and handled.
 */
export function buildHistoryGuardScript() {
  return `(function() {
  var reported = false;
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
        return original.apply(window.history, arguments);
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
