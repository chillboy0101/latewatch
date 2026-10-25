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

test('check-in details card keeps the same row height on every phone', () => {
  // Rows are a fixed height and the card is not stretched; the status card takes the space left.
  const details = page.slice(page.indexOf('Fixed-height rows'), page.indexOf('<ReminderPrompt'));
  assert.match(details, /flex shrink-0 flex-col rounded-2xl/);
  assert.equal([...details.matchAll(/flex h-14 items-center justify-between/g)].length, 3); // in, out, penalty
  assert.doesNotMatch(details, /flex-1/);
});

test('short phones (iPhone SE) tighten only the status card so the page fits without scrolling', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');
  assert.match(css, /@custom-variant short \(@media \(max-height: 720px\)\);/);
  const statusCard = page.slice(page.indexOf("statusTone(status))}>") - 200, page.indexOf('Fixed-height rows'));
  assert.match(statusCard, /short:py-3/);
  assert.match(statusCard, /short:text-xl/);
});
