/**
 * Inline script for the root layout, run before the app starts. Safari throws when a page updates
 * its history more than 100 times in 10 seconds (about 60 quick taps between two screens), and
 * that error inside a navigation broke the whole screen. Past the limit an update is now skipped:
 * the screen still changes, and updates work again once the 10 seconds are up. Any other error is
 * passed on as before.
 */
export function buildHistoryGuardScript() {
  return `(function() {
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = window.history[name];
    if (typeof original !== 'function') return;
    window.history[name] = function () {
      try {
        return original.apply(window.history, arguments);
      } catch (error) {
        if (error && error.name === 'SecurityError') {
          console.warn('History update skipped:', error.message);
          return undefined;
        }
        throw error;
      }
    };
  });
})();`;
}
