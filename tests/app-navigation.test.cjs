/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('screens slide in and out like an app, and back buttons step back instead of stacking pages', () => {
  const nav = read('src', 'lib', 'app-nav.ts');
  // The way back is kept on each history entry, so it can't drift from the real history; back pops
  // to the previous entry, with each screen's parent as the fallback.
  assert.match(nav, /if \(own && own\.at\(-1\) === pathname\) \{\n\s*\/\/[^\n]*\n[^\n]*\n\s*currentStack = own;/);
  assert.match(nav, /window\.history\.replaceState\(\{ \.\.\.window\.history\.state, \[STACK_STATE\]: currentStack, \[INDEX_STATE\]: currentIndex \}, ''\);/);
  // The portal home is the first screen and sign-in screens are dropped: no back swipe into either.
  assert.match(nav, /if \(pathname === '\/' \|\| \(left !== undefined && isAuthScreen\(left\)\)\) stack = \[pathname\];/);
  assert.match(nav, /if \(pathname === '\/' \|\| isAuthScreen\(pathname\)\) return null;/);
  assert.match(nav, /if \(canGoBack\(\)\) \{\n\s*slideTo\(direction, \(\) => \{\n\s*skipSameScreenEntries\(\);\n\s*window\.history\.back\(\);/);
  // Back never shows the same screen again: leftover entries for it are skipped.
  assert.match(nav, /if \(window\.location\.pathname === leaving && !sheetOpen && skips < MAX_SAME_SCREEN_SKIPS\) \{\n\s*skips \+= 1;\n\s*window\.history\.back\(\);/);
  assert.match(nav, /replaceTop = true;\n\s*slideTo\(direction, \(\) => router\.replace\(fallbackHref\)\);/);
  // View transitions hold the old screen until the new one has rendered, with reduced motion respected.
  assert.match(nav, /document\.startViewTransition\(\(\) => new Promise<void>/);
  assert.match(nav, /prefers-reduced-motion: reduce/);
  // iPhones and iPads get no app slides (iOS has its own; Safari leaves a grey layer after them).
  assert.match(nav, /prefersReducedMotion\(\) \|\| isAppleTouchDevice\(\)\) \{/);

  const css = read('src', 'app', 'globals.css');
  assert.match(css, /html\[data-nav="forward"\]::view-transition-new\(root\) \{[^}]*nav-in-from-right/);
  assert.match(css, /html\[data-nav="back"\]::view-transition-old\(root\) \{[^}]*nav-out-to-right/);
  // Only transforms: Safari draws filters and shadows on these slides as a dark layer.
  const slideCss = css.slice(css.indexOf('html[data-nav]'), css.indexOf('@keyframes nav-in-from-left'));
  assert.doesNotMatch(slideCss, /filter|box-shadow/);
  // A screen slower than the wait gets no slide (no old screen sliding over itself).
  assert.match(nav, /finishSlide = null;\n\s*transition\.skipTransition\(\);\n\s*resolve\(\);/);

  // The staff screens use it: portal cards slide forward, back buttons and "Portal Home" step back.
  const portal = read('src', 'components', 'layout', 'portal-ui.tsx');
  assert.match(portal, /if \(back\) navigation\.back\(href\);\n\s*else if \(replace\) navigation\.replace\(href\);\n\s*else navigation\.forward\(href\);/);
  assert.match(read('src', 'components', 'layout', 'desktop-required-screen.tsx'), /<ChoiceCard\n\s*back\n\s*href="\/"/);
  // "Admin needs a computer" is a dead end: the attendance portal opens in its place, so back skips it.
  assert.match(read('src', 'components', 'layout', 'desktop-required-screen.tsx'), /href="\/check-in"\n\s*icon=\{<LogIn className="h-\[22px\] w-\[22px\]" \/>\}\n\s*replace\n/);
  assert.match(portal, /else if \(replace\) navigation\.replace\(href\);/);
  assert.match(nav, /replaceTop = true;\n\s*slideTo\('forward', \(\) => router\.replace\(href\)\);/);
  const checkIn = read('src', 'app', 'check-in', 'page.tsx');
  assert.match(checkIn, /navigation\.back\('\/'\);/);
  // "Back to portal" steps back too, a receipt opens with the slide, and the ?receipts=1 strip keeps the entry's state.
  assert.match(checkIn, /navigation\.back\('\/'\);\n\s*\}\}\n\s*>\n\s*Back to portal/);
  assert.match(checkIn, /navigation\.forward\(notification\.href\);/);
  assert.match(checkIn, /window\.history\.replaceState\(window\.history\.state, '', '\/check-in'\);/);
  assert.match(read('src', 'app', 'check-in', 'receipts', '[paymentId]', 'page.tsx'), /navigation\.back\('\/check-in\?receipts=1'\);/);
});

test("the edge swipe back is the phone's own, and no swipe forward reopens a screen", () => {
  const page = read('src', 'components', 'layout', 'app-page.tsx');
  // No custom swipe on top of the phone's own (iOS draws the previous screen under the finger).
  assert.doesNotMatch(page, /touchstart|touchmove/);
  assert.match(page, /useEffect\(\(\) => \{\n\s*recordPathname\(pathname\);\n\s*\}, \[pathname\]\);/);
  // Going back leaves a dead end ahead, and landing on it (iOS's swipe forward) steps straight back.
  assert.match(page, /window\.addEventListener\('popstate', handlePopState\);/);
  const navFile = read('src', 'lib', 'app-nav.ts');
  assert.match(navFile, /if \(isDeadEndEntry\(\)\) \{\n\s*window\.history\.back\(\);/);
  // A swipe back from the portal home (the first screen) returns straight to it.
  assert.match(navFile, /if \(fromHome && \(index === null \|\| index < currentIndex\)\) window\.history\.forward\(\);/);
  // Going back onto the sign-in page while signed in steps forward again (no second portal home).
  const authCard = read('src', 'components', 'auth', 'clerk-auth-card.tsx');
  assert.match(authCard, /if \(!arrivedSignedIn\) return;\n(\s*\/\/[^\n]*\n)*\s*window\.history\.forward\(\);/);
  assert.match(authCard, /if \(arrivedSignedIn\) return null;/);
  const nav = read('src', 'lib', 'app-nav.ts');
  assert.match(nav, /if \(cameBack\) leaveDeadEnd\(\);/);
  assert.match(nav, /window\.history\.pushState\(\{ \.\.\.window\.history\.state, \[DEAD_END_STATE\]: true \}, ''\);/);
  // The step back off it waits so iOS keeps a picture of it (else the swipe slides in a white page).
  assert.match(nav, /if \(isDeadEndEntry\(\)\) window\.history\.back\(\);\n\s*\}, DEAD_END_SNAPSHOT_MS\);/);
  assert.match(read('src', 'app', 'layout.tsx'), /<AppPage>\n\s*<AppShell>\{children\}<\/AppShell>\n\s*<\/AppPage>/);
});

test('back closes the top sheet instead of leaving the screen', () => {
  const drawer = read('src', 'components', 'ui', 'drawer.tsx');
  assert.match(drawer, /window\.history\.pushState\(state, ''\);/);
  assert.match(drawer, /if \(top === null \|\| top < id\) \{\n\s*closedByBack = true;\n\s*closeRef\.current\?\.\(false\);/);
  assert.match(drawer, /if \(!closedByBack && top !== null && top >= id\) popSheetEntries\(\);/);
  // Never history.go(0), which would reload the page.
  assert.match(drawer, /if \(count === 0\) return;\n[\s\S]*window\.history\.go\(-count\);/);
  // A late repeat of the opening tap (iPhones) lands behind a sheet still sliding up: ignored.
  assert.match(drawer, /if \(!open\) return;\n\s*lastSheetOpenedAt = performance\.now\(\);/);
  assert.match(drawer, /if \(performance\.now\(\) - lastSheetOpenedAt < OPEN_GRACE_MS\) event\.preventDefault\(\);/);
  // Closed sheets are capped off, so a swipe forward can't reopen one (unless a sheet opened meanwhile,
  // whose new entry drops them anyway).
  assert.match(drawer, /popsInFlight\.push\(pop\);\n\s*window\.history\.go\(-count\);/);
  assert.match(drawer, /if \(!added\) window\.setTimeout\(leaveDeadEnd, 0\);/);
  assert.match(drawer, /closeRef\.current\?\.\(false\);\n\s*\/\/[^\n]*\n\s*window\.setTimeout\(leaveDeadEnd, 0\);/);
  // A child sheet opening with its parent adds its entry after the parent's, so back closes the child.
  assert.match(drawer, /if \(nested\) queueMicrotask\(addEntry\);\n\s*else addEntry\(\);/);
  assert.match(drawer, /useCloseOnBack\(props\.open, props\.onOpenChange\);\n[\s\S]*useCloseOnBack\(props\.open, props\.onOpenChange, true\);/);
});

test('a sheet opened while another is closing keeps its place in the history and gets the tap', () => {
  const drawer = read('src', 'components', 'ui', 'drawer.tsx');
  // Opened while a closed sheet's entry is still coming off: its entry goes in after that lands.
  assert.match(drawer, /if \(popsInFlight\.length > 0\) \{\n\s*openingAfterPops\.push\(addEntry\);\n\s*return true;\n\s*\}/);
  // Steps back land in the order sent: each popstate lands the oldest, and sheets go in after the last.
  assert.match(drawer, /function onPopLanded\(\) \{\n\s*settlePop\(popsInFlight\.shift\(\)\);/);
  assert.match(drawer, /if \(popsInFlight\.length > 0\) return;/);
  // A sheet that closed before its entry went in adds nothing, and the closed entries are capped off.
  assert.match(drawer, /const added = openingAfterPops\.splice\(0\)\.map\(\(addEntry\) => addEntry\(\)\)\.some\(Boolean\);/);
  assert.match(drawer, /if \(cancelled\) return false;/);
  // A step back that never reports landing doesn't keep sheets waiting.
  assert.match(drawer, /\}, POP_SETTLE_MS\),/);
  // On the dead end left by a close, the new sheet's entry takes its place, without the dead-end mark
  // (an entry carrying it would be stepped off, closing the new sheet and the one under it).
  assert.match(drawer, /const state = \{ \.\.\.stateWithoutDeadEnd\(\), latewatchSheet: id \};/);
  assert.match(drawer, /\} else if \(isDeadEndEntry\(\)\) \{\n\s*\/\/[^\n]*\n\s*window\.history\.replaceState\(state, ''\);/);
  const nav = read('src', 'lib', 'app-nav.ts');
  assert.match(nav, /export function stateWithoutDeadEnd\(\)/);
  assert.match(nav, /delete rest\[DEAD_END_STATE\];/);
  // A sheet or backdrop sliding away never catches a tap (Radix sets an inline pointer-events, hence !).
  assert.match(drawer, /'fixed inset-0 z-50 data-\[state=closed\]:pointer-events-none!'/);
  assert.match(drawer, /'data-\[state=closed\]:pointer-events-none!',/);
});
