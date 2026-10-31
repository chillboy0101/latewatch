/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('the dashboard Today card only reads today\'s attendance and refreshes at once', () => {
  const route = read('src/app/api/attendance/route.ts');
  // sync=0 skips bringing the day's charges up to date; every other caller still syncs first.
  assert.match(route, /if \(url\.searchParams\.get\('sync'\) !== '0'\) \{\n\s+await requiredAttendanceQuery\('attendance-lateness-sync'/);

  const page = read('src/app/dashboard/page.tsx');
  assert.match(page, /fetch\(`\/api\/attendance\?date=\$\{dateKey\}&sync=0`/);
  // No delayed reload: each check-in or permission event reloads the card straight away.
  assert.doesNotMatch(page, /TODAY_REFRESH_DELAY_MS|scheduleToday|setTimeout/);
  assert.match(page, /channel: 'attendance', events: \['invalidate'\], onEvent: \(\) => void fetchToday\(\)/);
});
