/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('on phones the admin portal shows the "admin needs a computer" page', () => {
  const layout = read('src', 'components', 'layout', 'dashboard-layout.tsx');
  // One or the other is rendered (not both hidden by CSS), chosen by the device's screen.
  assert.match(layout, /useSyncExternalStore\(subscribeDeviceKind, getDeviceKind, getServerDeviceKind\)/);
  assert.match(layout, /if \(deviceKind === 'phone'\) \{\s*return <DesktopRequiredScreen \/>;/);
  assert.doesNotMatch(layout, /lg:flex|lg:hidden/);

  const screen = read('src', 'components', 'layout', 'desktop-required-screen.tsx');
  assert.match(screen, /<main className="relative flex min-h-dvh flex-col[^"]*">/);
  // No logo: just the theme and mode buttons at the top.
  assert.doesNotMatch(screen, /LateWatchLogo/);
  // Applies dark mode itself, since the admin header isn't rendered on phones.
  assert.match(screen, /useApplyDarkMode\(\);/);
  // The drawing with the message under it in handwritten lettering, centred above the panel.
  assert.match(screen, /<div className="flex min-h-0 flex-1 flex-col items-center justify-center[^"]*">\s*<DevicesIllustration \/>\s*<h1 className=\{cn\(handwriting\.className, [^)]*\)\}>\s*Admin needs\s*<span className="block" style=\{\{ color: ink \}\}>a computer<\/span>\s*<\/h1>/);
  // The panel holds only the two choice cards: attendance portal first (highlighted), then home.
  assert.match(screen, /<ChoicePanel label="Where to go">\s*<ChoiceCard\s+highlight/);
  // The tick is on the laptop (the right device); the phone is faded.
  assert.match(screen, /h-\[118px\] w-\[184px\][\s\S]*?<Check className="h-4 w-4"[\s\S]*?<\/div>\s*<div className="absolute -left-3\.5/);
  assert.match(screen, /highlight\s+href="\/check-in"[\s\S]{0,120}title="Attendance Portal"/);
  assert.match(screen, /href="\/"[\s\S]{0,120}title="Portal Home"/);
  // Cards a little larger than the mockup (86px tall, 48px icons), shared with the portal home.
  const portalUi = read('src', 'components', 'layout', 'portal-ui.tsx');
  assert.match(portalUi, /'flex h-\[86px\] items-center gap-4 rounded-\[22px\]/);
  assert.match(portalUi, /'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl'/);
  assert.match(portalUi, /document\.documentElement\.classList\.toggle\('dark', isDark\)/);
  // Colours come from the theme, so it works in every theme and in light and dark mode.
  assert.match(screen, /color-mix\(in oklab, var\(--primary\) 55%, var\(--foreground\)\)/);
});

test('phone or computer is judged by the screen, not the window', () => {
  require('tsx/cjs');
  const { deviceKindForScreen } = require('../src/lib/device-kind.ts');
  assert.equal(deviceKindForScreen(390, 844), 'phone');
  assert.equal(deviceKindForScreen(844, 390), 'phone'); // phone turned sideways
  assert.equal(deviceKindForScreen(768, 1024), 'computer'); // iPad in portrait
  assert.equal(deviceKindForScreen(1440, 900), 'computer'); // laptop, whatever the window size
});

test('portal home: live clock on top, the two portals in the bottom panel, no descriptions', () => {
  const home = read('src', 'app', 'page.tsx');
  assert.match(home, /<PortalPickers \/>/);
  assert.match(home, /<LiveClock \/>\s*<\/div>\s*<ChoicePanel label="Choose a portal">/);
  assert.match(home, /<ChoiceCard highlight href="\/check-in"[^\n]*title="Attendance Portal" \/>\s*<ChoiceCard href="\/dashboard"[^\n]*title="Admin Portal" \/>/);
  assert.match(home, /useApplyDarkMode\(\);/);
  assert.doesNotMatch(home, /description|Staff check-in and check-out|LateWatchLogo/);
});
