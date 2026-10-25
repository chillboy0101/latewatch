/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('buttons and portal cards look raised and press in when tapped', () => {
  const button = read('src', 'components', 'ui', 'button.tsx');
  // A smooth press: quick in, slow spring back, no pixel jump.
  assert.match(button, /export const PRESS = '[^']*duration-300 ease-\[cubic-bezier\(0\.22,1,0\.36,1\)\] active:scale-\[0\.97\] active:duration-100/);
  assert.doesNotMatch(button, /translate-y-px/);
  // No coloured glow under buttons.
  assert.doesNotMatch(button, /color-mix\(in_oklab,var\(--(primary|danger)\)_55%/);
  // The solid buttons keep their colour under the sheen (bg-gradient-to-* would make cn drop bg-primary).
  assert.match(button, /'bg-primary bg-linear-to-b from-white\/12/);
  assert.doesNotMatch(button, /bg-gradient-to/);
  assert.match(button, /active:shadow-\[inset_/);
  const portal = read('src', 'components', 'layout', 'portal-ui.tsx');
  assert.match(portal, /export const CHOICE_PRESS = cn\(PRESS,/);
  assert.doesNotMatch(portal, /0_8px_20px_-10px|shadow-primary\/25/);
});

test('phones get a haptic tap on every link and button: vibration on Android, a real switch on iPhone', () => {
  const haptics = read('src', 'lib', 'haptics.ts');
  assert.match(haptics, /navigator\.vibrate\(10\)/);
  // iOS 26.5+ ignores switches toggled from script, so no label.click() trick.
  assert.doesNotMatch(haptics, /label\.click/);
  const listener = read('src', 'components', 'layout', 'haptic-feedback.tsx');
  assert.match(listener, /\(pointer: coarse\)/);
  assert.match(listener, /event\.isTrusted && isTappable\(event\.target\)/);
  assert.match(read('src', 'app', 'layout.tsx'), /<HapticFeedback \/>/);

  // iPhone: an invisible native switch the finger toggles, which then clicks its button or link.
  const hapticSwitch = read('src', 'components', 'ui', 'haptic-switch.tsx');
  assert.match(hapticSwitch, /isAppleTouchDevice\(\) \|\| \(typeof navigator\.vibrate !== 'function' && window\.matchMedia\('\(pointer: coarse\)'\)\.matches\)/);
  assert.match(hapticSwitch, /\/iPad\|iPhone\|iPod\/\.test\(navigator\.userAgent\)/);
  assert.match(hapticSwitch, /element\?\.setAttribute\('switch', ''\)/);
  assert.match(hapticSwitch, /event\.stopPropagation\(\);[\s\S]*host\?\.click\(\);/);
  const css = read('src', 'app', 'globals.css');
  assert.match(css, /input\.haptic-switch\.haptic-switch \{[^}]*appearance: auto;[^}]*inset: 0;[^}]*width: 100%;\n\s*height: 100%;[^}]*opacity: 0;/);
  assert.doesNotMatch(css.match(/input\.haptic-switch\.haptic-switch \{[^}]*\}/)[0], /display: none|visibility: hidden/);
  // Every Button (asChild links too), portal card and sheet row carries one.
  const button = read('src', 'components', 'ui', 'button.tsx');
  assert.match(button, /<Slottable>\{children\}<\/Slottable>\n\s*<HapticSwitch \/>/);
  assert.match(read('src', 'components', 'layout', 'portal-ui.tsx'), /<HapticSwitch \/>\n\s*<\/Link>/);
  assert.match(read('src', 'app', 'check-in', 'page.tsx'), /<HapticSwitch \/>\n\s*<\/button>/);
});

test('no sunray pattern behind the staff screens', () => {
  assert.doesNotMatch(read('src', 'app', 'globals.css'), /sunray|repeating-conic-gradient/);
  for (const file of [['src', 'app', 'page.tsx'], ['src', 'app', 'check-in', 'page.tsx'], ['src', 'components', 'layout', 'desktop-required-screen.tsx']]) {
    assert.doesNotMatch(read(...file), /sunray/);
  }
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

test('the reminders sheet toggles and the receipt rows match the portal cards too', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  assert.equal([...page.matchAll(/className=\{cn\(CHOICE_PRESS, CHOICE_PLAIN, CHOICE_SIZE, 'w-full gap-4 px-\[18px\] text-left/g)].length, 3); // more-sheet rows, reminder toggles, receipts
  assert.match(page, /<div className="grid gap-3">\n\s*<ReminderNotificationToggle/);
  assert.match(page, /<ul className="grid gap-3">\n\s*\{notifications\.map/);
  assert.equal([...page.matchAll(/<HapticSwitch \/>/g)].length, 3);
});
