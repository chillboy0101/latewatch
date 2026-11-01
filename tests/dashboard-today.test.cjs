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
  assert.match(page, /fetch\('\/api\/attendance', \{ cache: 'no-store', signal: controller\.signal \}\)/);
  // A failed load keeps the last good data instead of removing the card.
  assert.doesNotMatch(page, /setToday\(null\)/);
  // Today's week row is found by its date, not by rebuilding the "Fri 31" label.
  assert.match(page, /find\(\(day\) => day\.date === todayKey\)/);
  // Each check-in or permission event reloads the card straight away, once: the attendance event does it,
  // and the dashboard event (sent alongside it) only reloads the stats.
  assert.match(page, /channel: 'attendance', events: \['invalidate'\], onEvent: \(\) => void fetchToday\(\)/);
  assert.match(page, /onEvent: \(\) => void fetchDashboardData\(\),/);
  assert.doesNotMatch(page, /TODAY_REFRESH_DELAY_MS|scheduleToday/);
});

test('the Today card keeps itself current and never gets stuck', () => {
  const page = read('src/app/dashboard/page.tsx');
  // Every minute, so passing times ("Expected later" to "Overdue") and a failed load are picked up.
  assert.match(page, /const TODAY_REFRESH_MS = 60_000;/);
  assert.match(page, /const todayRefresh = setInterval\(\(\) => void fetchToday\(\), TODAY_REFRESH_MS\);/);
  // The day changes by the server's date, not the laptop clock; the week rows reload with it.
  assert.doesNotMatch(page, /getAccraDateKey/);
  assert.match(page, /const dayChanged = todayDateRef\.current !== null && todayDateRef\.current !== data\.date;/);
  assert.match(page, /if \(dayChanged\) void fetchDashboardData\(\);/);
  // A hung request gives up after 15 seconds, so the one-at-a-time guard always clears.
  assert.match(page, /const timeout = setTimeout\(\(\) => controller\.abort\(\), TODAY_TIMEOUT_MS\);/);
  assert.match(page, /\} finally \{\n\s+clearTimeout\(timeout\);/);
});

test('the Today card counts each person once and copes with a missing check-in time', () => {
  const card = read('src/components/dashboard/today-card.tsx');
  assert.match(card, /Boolean\(row\.attendance\?\.checkInTime\) && !hasStatus\(row, 'late'\) && !hasStatus\(row, 'on_leave'\)/);
  assert.match(card, /label: 'on time', value: onTime \}/);
  assert.doesNotMatch(card, /totals\.onTime/);
  assert.match(card, /checkInTime: string \| null;/);
  assert.match(card, /row\.attendance\?\.checkInTime\?\.slice\(0, 5\)/);
});
