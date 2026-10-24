/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/components/layout/dashboard-layout.tsx'), 'utf8');

test('on phones the admin portal shows a screen styled like the attendance portal', () => {
  // Same shell as the check-in page: full-height card, theme and mode pickers, tinted status card.
  assert.match(source, /<main className="flex h-dvh flex-col overflow-hidden overscroll-none bg-background text-foreground lg:hidden">/);
  assert.match(source, /<ThemePicker buttonVariant="glass"/);
  assert.match(source, /<ModePicker buttonVariant="glass"/);
  assert.match(source, /rounded-2xl border border-primary\/25 bg-primary\/10/);
  assert.match(source, /bg-current\/20 ring-1 ring-current\/30[\s\S]{0,120}<Monitor /);
  // Big rounded actions: attendance portal first, then portal home.
  assert.match(source, /h-14 w-full gap-2\.5 rounded-2xl[\s\S]{0,120}<Link href="\/check-in">[\s\S]{0,160}Open Attendance Portal/);
  assert.match(source, /<Link href="\/">[\s\S]{0,120}Portal Home/);
  assert.match(source, /<div className="relative hidden h-screen w-full overflow-hidden lg:flex">/);
});
