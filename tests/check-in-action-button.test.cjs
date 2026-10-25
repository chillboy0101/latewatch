/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'check-in', 'page.tsx'), 'utf8');

test('check-in and device-transfer buttons are big, thumb-sized buttons', () => {
  // Both main actions use the one ActionButton, as tall as the portal choice cards (86px).
  assert.equal([...page.matchAll(/<ActionButton\b/g)].length, 2);
  assert.match(page, /h-\[86px\]/);
  // Just the button made bigger: its own icon and the label, no icon tile or arrow.
  const button = page.slice(page.indexOf('function ActionButton('), page.indexOf('// Every status follows the theme colour.'));
  assert.doesNotMatch(button, /ArrowRight|rounded-2xl bg-primary-foreground/);
  assert.match(button, /busy \? <Loader2[^\n]*animate-spin/);
});

test('check-in page keeps the same proportions on every phone', () => {
  // Status and details cards always split the space 6:5 (min-h-0 so content never changes the split).
  assert.match(page, /'min-h-0 flex-\[6\] rounded-2xl border \[container-type:size\]'/);
  assert.match(page, /flex min-h-0 flex-\[5\] flex-col rounded-2xl border border-border bg-card/);
  // The status card's badge, text and spacing scale with its height, so it fits on small phones.
  const statusCard = page.slice(page.indexOf('[container-type:size]'), page.indexOf("Rows share the card's height evenly"));
  assert.match(statusCard, /size-\[clamp\([^)]*cqh[^)]*\)\]/);
  assert.match(statusCard, /text-\[clamp\([^)]*cqh[^)]*\)\]/);
  // Details rows share the card evenly (checked in, checked out, and penalty when owed).
  const details = page.slice(page.indexOf("Rows share the card's height evenly"), page.indexOf('<ReminderPrompt'));
  assert.equal([...details.matchAll(/flex flex-1 items-center justify-between gap-3/g)].length, 3);
});
