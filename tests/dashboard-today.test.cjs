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
  // Any change reloads the card at once (staff and holiday changes too), and a check-in's dashboard and
  // attendance events, sent together, make one reload.
  assert.match(page, /const TODAY_EVENT_BATCH_MS = 300;/);
  assert.match(page, /channel: 'attendance', events: \['invalidate'\], onEvent: reloadTodayForEvent \}/);
  assert.match(page, /void fetchDashboardData\(\);\n\s*reloadTodayForEvent\(\);/);
  assert.match(page, /if \(todayEventTimer\) return;/);
  assert.doesNotMatch(page, /TODAY_REFRESH_DELAY_MS|scheduleToday/);
});

test('the Today card keeps itself current and never gets stuck', () => {
  const page = read('src/app/dashboard/page.tsx');
  // Every minute, so passing times ("Expected later" to "Overdue") and a failed load are picked up.
  assert.match(page, /const TODAY_REFRESH_MS = 60_000;/);
  assert.match(page, /const todayRefresh = setInterval\(\(\) => \{/);
  // The day changes by the server's date, not the laptop clock; the week rows reload with it, and
  // again each minute until that works.
  assert.doesNotMatch(page, /getAccraDateKey/);
  // The stats carry their own day from the API, and only the latest stats request can update them.
  assert.match(page, /if \(statsDateRef\.current !== null && statsDateRef\.current !== data\.date\) void fetchDashboardData\(\);/);
  assert.match(page, /statsDateRef\.current = typeof data\.date === 'string' \? data\.date : null;/);
  assert.match(page, /const request = \+\+statsRequestRef\.current;/);
  assert.match(page, /if \(request !== statsRequestRef\.current\) return;/);
  assert.match(read('src/app/api/dashboard/route.ts'), /date: today,\n\s*missedReminders,/);
  // A hidden tab doesn't poll; coming back to it reloads at once.
  assert.match(page, /if \(document\.visibilityState !== 'hidden'\) void fetchToday\(\);/);
  assert.match(page, /document\.addEventListener\('visibilitychange', onVisible\);/);
  // A hung request gives up after 15 seconds, so the one-at-a-time guard always clears.
  assert.match(page, /const timeout = setTimeout\(\(\) => controller\.abort\(\), TODAY_TIMEOUT_MS\);/);
  assert.match(page, /\} finally \{\n\s+clearTimeout\(timeout\);/);
});

test('the Today card counts each person once and copes with a missing check-in time', () => {
  const card = read('src/components/dashboard/today-card.tsx');
  // On time is the API's count (checked in on time, not on leave), the same as the attendance overview.
  assert.match(card, /label: 'on time', value: totals\.onTime \}/);
  // On leave but checked in late: counted once, under late.
  assert.match(card, /const onLeave = today\.rows\.filter\(\(row\) => hasStatus\(row, 'on_leave'\) && !hasStatus\(row, 'late'\)\)\.length;/);
  assert.match(card, /label: 'on leave', value: onLeave \}/);
  assert.match(read('src/app/api/attendance/route.ts'), /if \(isOnTimeAttendanceRow\(row\) && !row\.statuses\.includes\('on_leave'\)\) acc\.onTime \+= 1;/);
  assert.match(card, /checkInTime: string \| null;/);
  assert.match(card, /row\.attendance\?\.checkInTime\?\.slice\(0, 5\)/);
});
