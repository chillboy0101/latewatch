/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('GET /api/attendance only reads; POST brings charges up to date first', () => {
  const route = read('src/app/api/attendance/route.ts');
  // A plain GET (a link, a page load) can never change charges.
  assert.match(route, /export async function GET\(request: NextRequest\) \{\n\s+return attendanceResponse\(request, \{ sync: false \}\);/);
  assert.match(route, /export async function POST\(request: NextRequest\) \{\n\s+return attendanceResponse\(request, \{ sync: true \}\);/);
  assert.match(route, /if \(sync\) \{\n\s+await requiredAttendanceQuery\('attendance-lateness-sync'/);
  assert.doesNotMatch(route, /searchParams\.get\('sync'\)/);

  // The attendance overview still brings the day up to date, through POST.
  const overview = read('src/app/attendance/overview/page.tsx');
  assert.match(overview, /fetch\(`\/api\/attendance\?date=\$\{attendanceDate\}`, \{ cache: 'no-store', method: 'POST' \}\)/);
});

test('the dashboard Today card only reads today\'s attendance and refreshes at once', () => {
  const page = read('src/app/dashboard/page.tsx');
  // A plain GET with no date: read-only, and the server picks today, so a wrong laptop clock can't shift it.
  assert.match(page, /fetch\('\/api\/attendance', \{ cache: 'no-store' \}\)/);
  // A failed load keeps the last good data instead of removing the card.
  assert.doesNotMatch(page, /setToday\(null\)/);
  // Today's week row is found by its date, not by rebuilding the "Fri 31" label.
  assert.match(page, /find\(\(day\) => day\.date === todayKey\)/);
  // No delayed reload: each check-in or permission event reloads the card straight away.
  assert.doesNotMatch(page, /TODAY_REFRESH_DELAY_MS|scheduleToday|setTimeout/);
  assert.match(page, /channel: 'attendance', events: \['invalidate'\], onEvent: \(\) => void fetchToday\(\)/);
});
