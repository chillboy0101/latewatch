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

test('attendance status card carries the brush watermark behind its content', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  assert.match(page, /relative min-h-48 flex-\[6\] overflow-hidden/);
  assert.match(page, /<BrushWatermark \/>\n\s*<div className="relative flex h-full/);
});
