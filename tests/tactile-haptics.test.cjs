/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('buttons and portal cards look raised and press in when tapped', () => {
  const button = read('src', 'components', 'ui', 'button.tsx');
  assert.match(button, /active:translate-y-px active:scale-\[0\.98\]/);
  // The solid buttons keep their colour under the sheen (bg-gradient-to-* would make cn drop bg-primary).
  assert.match(button, /'bg-primary bg-linear-to-b from-white\/12/);
  assert.doesNotMatch(button, /bg-gradient-to/);
  assert.match(button, /active:shadow-\[inset_/);
  const portal = read('src', 'components', 'layout', 'portal-ui.tsx');
  assert.match(portal, /active:translate-y-px active:scale-\[0\.98\]/);
});

test('phones get a haptic tap on every link and button, Android and iOS', () => {
  const haptics = read('src', 'lib', 'haptics.ts');
  assert.match(haptics, /navigator\.vibrate\(10\)/);
  assert.match(haptics, /input\.setAttribute\('switch', ''\)/);
  assert.match(haptics, /label\.click\(\);\n\s*label\.remove\(\);/);
  const listener = read('src', 'components', 'layout', 'haptic-feedback.tsx');
  assert.match(listener, /\(pointer: coarse\)/);
  assert.match(listener, /event\.isTrusted && isTappable\(event\.target\)/);
  assert.match(read('src', 'app', 'layout.tsx'), /<HapticFeedback \/>/);
});

test('the staff screens have the sunray dial pattern behind them, in the theme colour', () => {
  const css = read('src', 'app', 'globals.css');
  assert.match(css, /\.sunray \{\n\s*isolation: isolate;/);
  assert.match(css, /\.sunray::before \{[^}]*position: fixed;[^}]*z-index: -1;[^}]*repeating-conic-gradient\([^)]*var\(--primary\)/);
  for (const file of [['src', 'app', 'page.tsx'], ['src', 'app', 'check-in', 'page.tsx'], ['src', 'components', 'layout', 'desktop-required-screen.tsx']]) {
    assert.match(read(...file), /<main className="[^"]*\bsunray"/);
  }
  // The status card has no watermark of its own any more.
  assert.doesNotMatch(read('src', 'app', 'check-in', 'page.tsx'), /BrushWatermark/);
});

test('the attendance "more" sheet rows look and press like the portal choice cards', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  assert.match(page, /className=\{cn\(CHOICE_PRESS, CHOICE_PLAIN, CHOICE_SIZE, 'w-full gap-4 px-\[18px\] text-left'\)\}/);
  assert.match(page, /<ul className="mt-4 grid gap-3">\n\s*<MenuRow/);
  const portal = read('src', 'components', 'layout', 'portal-ui.tsx');
  // ChoiceCard uses the same shared classes.
  assert.match(portal, /CHOICE_PRESS,\n\s*large \?/);
  assert.match(portal, /: CHOICE_PLAIN,/);
});
