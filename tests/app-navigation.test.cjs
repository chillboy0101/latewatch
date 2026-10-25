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
  assert.match(nav, /window\.history\.replaceState\(\{ \.\.\.window\.history\.state, \[STACK_STATE\]: currentStack \}, ''\);/);
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

  const css = read('src', 'app', 'globals.css');
  assert.match(css, /html\[data-nav="forward"\]::view-transition-new\(root\) \{[^}]*nav-in-from-right/);
  assert.match(css, /html\[data-nav="back"\]::view-transition-old\(root\) \{[^}]*nav-out-to-right/);

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
  assert.match(page, /if \(isDeadEndEntry\(\)\) window\.history\.back\(\);/);
  const nav = read('src', 'lib', 'app-nav.ts');
  assert.match(nav, /if \(cameBack\) leaveDeadEnd\(\);/);
  assert.match(nav, /window\.history\.pushState\(\{ \.\.\.window\.history\.state, \[DEAD_END_STATE\]: true \}, ''\);\n\s*window\.history\.back\(\);/);
  assert.match(read('src', 'app', 'layout.tsx'), /<AppPage>\n\s*<AppShell>\{children\}<\/AppShell>\n\s*<\/AppPage>/);
});

test('back closes the top sheet instead of leaving the screen', () => {
  const drawer = read('src', 'components', 'ui', 'drawer.tsx');
  assert.match(drawer, /window\.history\.pushState\(state, ''\);/);
  assert.match(drawer, /if \(top === null \|\| top < id\) \{\n\s*closedByBack = true;\n\s*closeRef\.current\?\.\(false\);/);
  assert.match(drawer, /if \(!closedByBack && top !== null && top >= id\) popSheetEntries\(\);/);
  // Never history.go(0), which would reload the page.
  assert.match(drawer, /if \(count === 0\) return;\n[\s\S]*window\.history\.go\(-count\);/);
  // Closed sheets are capped off, so a swipe forward can't reopen one.
  assert.match(drawer, /window\.addEventListener\('popstate', \(\) => window\.setTimeout\(leaveDeadEnd, 0\), \{ once: true \}\);/);
  assert.match(drawer, /closeRef\.current\?\.\(false\);\n\s*\/\/[^\n]*\n\s*window\.setTimeout\(leaveDeadEnd, 0\);/);
  // A child sheet opening with its parent adds its entry after the parent's, so back closes the child.
  assert.match(drawer, /if \(nested\) queueMicrotask\(addEntry\);\n\s*else addEntry\(\);/);
  assert.match(drawer, /useCloseOnBack\(props\.open, props\.onOpenChange\);\n[\s\S]*useCloseOnBack\(props\.open, props\.onOpenChange, true\);/);
});
