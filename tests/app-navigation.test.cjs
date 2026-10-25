/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('screens slide in and out like an app, and back buttons step back instead of stacking pages', () => {
  const nav = read('src', 'lib', 'app-nav.ts');
  // The visited screens are tracked; back pops them, with each screen's parent as the fallback.
  assert.match(nav, /else if \(stack\.at\(-2\) === pathname\) stack\.pop\(\);/);
  assert.match(nav, /if \(canGoBack\(\)\) \{\n\s*slideTo\(direction, \(\) => window\.history\.back\(\)\);/);
  assert.match(nav, /replaceTop = true;\n\s*slideTo\(direction, \(\) => router\.replace\(fallbackHref\)\);/);
  // View transitions hold the old screen until the new one has rendered, with reduced motion respected.
  assert.match(nav, /document\.startViewTransition\(\(\) => new Promise<void>/);
  assert.match(nav, /prefers-reduced-motion: reduce/);

  const css = read('src', 'app', 'globals.css');
  assert.match(css, /html\[data-nav="forward"\]::view-transition-new\(root\) \{[^}]*nav-in-from-right/);
  assert.match(css, /html\[data-nav="back"\]::view-transition-old\(root\) \{[^}]*nav-out-to-right/);
  assert.match(css, /html\[data-nav="swipe-back"\]::view-transition-old\(root\) \{[^}]*opacity: 0;/);

  // The staff screens use it: portal cards slide forward, back buttons and "Portal Home" step back.
  const portal = read('src', 'components', 'layout', 'portal-ui.tsx');
  assert.match(portal, /if \(back\) navigation\.back\(href\);\n\s*else navigation\.forward\(href\);/);
  assert.match(read('src', 'components', 'layout', 'desktop-required-screen.tsx'), /<ChoiceCard\n\s*back\n\s*href="\/"/);
  assert.match(read('src', 'app', 'check-in', 'page.tsx'), /navigation\.back\('\/'\);/);
  assert.match(read('src', 'app', 'check-in', 'receipts', '[paymentId]', 'page.tsx'), /navigation\.back\('\/check-in\?receipts=1'\);/);
});

test('the installed app gets an edge swipe back, and every screen is recorded for the back stack', () => {
  const page = read('src', 'components', 'layout', 'app-page.tsx');
  assert.match(page, /display-mode: standalone/);
  assert.match(page, /touch\.clientX > EDGE_PX/);
  assert.match(page, /document\.querySelector\('\[role="dialog"\]'\)/);
  assert.match(page, /navigateBack\(router, parentPath\(window\.location\.pathname\) \?\? '\/', 'swipe-back'\)/);
  assert.match(page, /clearDrag\(pageRef\.current\);\n\s*recordPathname\(pathname\);/);
  // A back that doesn't change screen still brings the page back after a moment.
  assert.match(page, /dragResetTimer\.current = window\.setTimeout\(\(\) => \{\n\s*dragResetTimer\.current = null;\n\s*clearDrag\(page\);/);
  assert.match(read('src', 'app', 'layout.tsx'), /<AppPage>\n\s*<AppShell>\{children\}<\/AppShell>\n\s*<\/AppPage>/);
});

test('back closes the top sheet instead of leaving the screen', () => {
  const drawer = read('src', 'components', 'ui', 'drawer.tsx');
  assert.match(drawer, /window\.history\.pushState\(state, ''\);/);
  assert.match(drawer, /if \(top === null \|\| top < id\) \{\n\s*closedByBack = true;\n\s*closeRef\.current\?\.\(false\);/);
  assert.match(drawer, /if \(!closedByBack && top !== null && top >= id\) popSheetEntries\(\);/);
  // Never history.go(0), which would reload the page.
  assert.match(drawer, /if \(count > 0\) window\.history\.go\(-count\);/);
  // A child sheet opening with its parent adds its entry after the parent's, so back closes the child.
  assert.match(drawer, /if \(nested\) queueMicrotask\(addEntry\);\n\s*else addEntry\(\);/);
  assert.match(drawer, /useCloseOnBack\(props\.open, props\.onOpenChange\);\n[\s\S]*useCloseOnBack\(props\.open, props\.onOpenChange, true\);/);
});
