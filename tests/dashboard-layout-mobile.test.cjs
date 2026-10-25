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
  assert.match(portalUi, /size\?: 'default' \| 'large'/);
  assert.match(portalUi, /'h-\[86px\] [^']*'/);
  assert.match(portalUi, /CHOICE_ICON = '[^']*h-12 w-12[^']*'/);
  // Keyboard focus stays visible in forced-colours mode (outline-hidden, not outline-none).
  assert.match(portalUi, /focus:outline-hidden/);
  assert.doesNotMatch(portalUi, /outline-none/);
  assert.match(portalUi, /document\.documentElement\.classList\.toggle\('dark', isDark\)/);
  // Colours come from the theme, so it works in every theme and in light and dark mode.
  assert.match(screen, /color-mix\(in oklab, var\(--primary\) 55%, var\(--foreground\)\)/);
});

test('phone or computer is judged by the device: touch-first with a small screen', () => {
  require('tsx/cjs');
  const { deviceKindFor } = require('../src/lib/device-kind.ts');
  const kind = (width, height, coarsePointer = true) => deviceKindFor({ coarsePointer, height, width });
  assert.equal(kind(390, 844), 'phone');
  assert.equal(kind(844, 390), 'phone'); // phone turned sideways
  assert.equal(kind(768, 1024), 'computer'); // iPad in portrait
  assert.equal(kind(1440, 900, false), 'computer'); // laptop, whatever the window size
  assert.equal(kind(1024, 576, false), 'computer'); // 1280x720 laptop at 125% scaling
});

test('portal home layout: phones and narrow windows compact, computers the wide card', () => {
  require('tsx/cjs');
  const { homeViewFor } = require('../src/lib/device-kind.ts');
  assert.equal(homeViewFor('phone', 390), 'compact');
  assert.equal(homeViewFor('phone', 1100), 'compact'); // a phone stays compact even if wide
  assert.equal(homeViewFor('computer', 768), 'compact'); // iPad portrait, half-width laptop window
  assert.equal(homeViewFor('computer', 1024), 'wide');
  assert.equal(homeViewFor('computer', 1440), 'wide');
});

test('portal home renders one layout, with the two portals in order and an office-time clock', () => {
  const home = read('src', 'app', 'page.tsx');
  assert.match(home, /useSyncExternalStore\(subscribeDeviceKind, getHomeView, getServerHomeView\)/);
  // Each layout renders only when chosen (both only before the browser answers).
  assert.match(home, /\{view !== 'wide' && \(/);
  assert.match(home, /\{view !== 'compact' && \(/);
  // Attendance first (highlighted), then Admin, in both layouts.
  const links = [...home.matchAll(/<ChoiceCard( highlight)?[^\n]*href="([^"]+)"[^\n]*title="([^"]+)"/g)].map((m) => [Boolean(m[1]), m[2], m[3]]);
  assert.deepEqual(links, [
    [true, '/check-in', 'Attendance Portal'],
    [false, '/dashboard', 'Admin Portal'],
    [true, '/check-in', 'Attendance Portal'],
    [false, '/dashboard', 'Admin Portal'],
  ]);
  assert.match(home, /<ChoiceCard highlight size="large"/);
  // The clock shows office (Accra) time and ticks inside its own card.
  assert.match(home, /timeZone: ACCRA_TIME_ZONE/);
  assert.match(home, /function ClockCard\([^)]*\) \{\s*const now = useNow\(\);/);
  // An analogue face: hour and minute hands and a smoothly sweeping second hand (set every animation
  // frame), with the time also given to screen readers.
  assert.deepEqual([...home.matchAll(/<Hand angle=\{(\w+)\}/g)].map((match) => match[1]), ['hours', 'minutes']);
  assert.match(home, /<SweepHand \/>/);
  assert.match(home, /frame = requestAnimationFrame\(draw\)/);
  assert.match(home, /<time className="sr-only">\{`\$\{pad\(now\.hours\)\}:\$\{pad\(now\.minutes\)\}`\}<\/time>/);
  assert.match(home, /useApplyDarkMode\(\);/);
  assert.doesNotMatch(home, /description|Staff check-in and check-out|LateWatchLogo/);
});
