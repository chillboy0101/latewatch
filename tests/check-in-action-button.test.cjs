/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'check-in', 'page.tsx'), 'utf8');

test('check-in and device-transfer buttons are big, thumb-sized action buttons', () => {
  // Both main actions use the one ActionButton, as tall as the portal choice cards (86px).
  assert.equal([...page.matchAll(/<ActionButton\b/g)].length, 2);
  assert.match(page, /function ActionButton\(/);
  assert.match(page, /h-\[86px\]/);
  // Icon tile, label and arrow; a spinner replaces the icon while busy; it shows when pressed.
  assert.match(page, /busy \? <Loader2[^\n]*animate-spin/);
  assert.match(page, /active:brightness-95/);
  // Long labels ("Registered Device Required") wrap instead of overflowing.
  assert.match(page, /whitespace-normal/);
});
