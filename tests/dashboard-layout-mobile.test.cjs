/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('on phones the admin portal shows the "admin needs a computer" page', () => {
  const layout = read('src', 'components', 'layout', 'dashboard-layout.tsx');
  assert.match(layout, /<DesktopRequiredScreen \/>\s*<div className="relative hidden h-screen w-full overflow-hidden lg:flex">/);

  const screen = read('src', 'components', 'layout', 'desktop-required-screen.tsx');
  assert.match(screen, /<main className="relative flex h-dvh flex-col[^"]*lg:hidden">/);
  // Glowing top with the laptop-and-phone drawing, centred above the panel.
  assert.doesNotMatch(screen, /radial-gradient/);
  assert.match(screen, /<div className="flex min-h-0 flex-1 items-center justify-center[^"]*">\s*<DevicesIllustration \/>/);
  // Panel with the heading and two choice cards: attendance portal first (highlighted), then home.
  assert.match(screen, /<h1[^>]*>Admin needs a computer<\/h1>/);
  // The tick is on the laptop (the right device); the phone is faded.
  assert.match(screen, /h-\[118px\] w-\[184px\][\s\S]*?<Check className="h-4 w-4"[\s\S]*?<\/div>\s*<div className="absolute -left-3\.5/);
  assert.match(screen, /highlight\s+href="\/check-in"[\s\S]{0,120}title="Attendance Portal"/);
  assert.match(screen, /href="\/"[\s\S]{0,120}title="Portal Home"/);
  // Cards a little larger than the mockup (86px tall, 48px icons).
  assert.match(screen, /'flex h-\[86px\] items-center gap-4 rounded-\[22px\]/);
  assert.match(screen, /'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl'/);
  // Colours come from the theme, so it works in every theme and in light and dark mode.
  assert.match(screen, /color-mix\(in oklab, var\(--primary\) 55%, var\(--foreground\)\)/);
});
