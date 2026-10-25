/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const page = read('src', 'app', 'check-in', 'page.tsx');

// The source between two markers; fails if either is missing, so a reworded marker can't make the
// checks below run against the rest of the file.
function section(start, end) {
  const from = page.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = page.indexOf(end, from);
  assert.ok(to > from, `marker not found after "${start}": ${end}`);
  return page.slice(from, to);
}

test('check-in and device-transfer buttons are one big button, sized like the portal cards', () => {
  const button = section('function ActionButton(', '// Every status follows the theme colour.');
  // Shares the portal choice card size instead of copying it.
  assert.match(button, /CHOICE_SIZE, CHOICE_TEXT/);
  assert.match(read('src', 'components', 'layout', 'portal-ui.tsx'), /export const CHOICE_SIZE = 'h-\[86px\]/);
  // Its own icon and the label; no icon tile or arrow.
  assert.doesNotMatch(button, /ArrowRight|bg-primary-foreground\/15/);
  // Busy: spinner, and the busy label is announced to screen readers.
  assert.match(button, /busy \? <Loader2[^\n]*animate-spin/);
  assert.match(button, /role="status">\{busy \? label : ''\}/);
  // One condition picks which of the two buttons shows.
  const actions = section('{needsTransfer ? (', '</Card>');
  assert.equal([...actions.matchAll(/<ActionButton\b/g)].length, 2);
  // The sign-out time keeps "4:30 PM" together at the source, not by post-processing every label.
  assert.match(page, /Check Out Opens \$\{status\.signOutStartLabel\.replace\(' ', '\\u00a0'\)\}/);
});

test('check-in page keeps the same proportions on every phone', () => {
  const statusCard = section('The status card and the details card share the space 6:5', "Rows share the card's height evenly");
  const details = section("Rows share the card's height evenly", '<ReminderPrompt');
  // The two cards split the space 6:5.
  assert.match(statusCard, /flex-\[6\]/);
  assert.match(details, /flex-\[5\]/);
  // The status card scales its contents with its height where container units exist, with fixed
  // sizes as the fallback, and never gets shorter than its smallest content.
  assert.match(statusCard, /\[container-type:size\]/);
  assert.match(statusCard, /min-h-48/);
  assert.match(statusCard, /size-24 [^"]*supports-\[height:1cqh\]:size-\[clamp\([^)]*cqh/);
  assert.match(statusCard, /text-2xl [^"]*supports-\[height:1cqh\]:text-\[clamp\([^)]*cqh/);
  // Details rows share the card evenly and the card never shrinks below them.
  assert.doesNotMatch(details.split('\n').find((line) => line.includes('flex-[5]')), /min-h-0/);
  assert.equal([...details.matchAll(/min-h-12 flex-1 items-center justify-between/g)].length, 3); // in, out, penalty
});
