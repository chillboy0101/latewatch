/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('leave recorded after the fact clears the unpaid charges already made for those days', () => {
  const route = read('src', 'app', 'api', 'attendance', 'leave', 'route.ts');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.match(post, /await recalculateDaysAfterLeaveChange\(startDate, endDate\);/);
  assert.ok(post.indexOf('recalculateDaysAfterLeaveChange(startDate, endDate)') > post.indexOf('db.insert(staffLeavePeriod)'));
});

test('the 4:30 PM job re-checks the past week, so a missed sign-out is always charged', () => {
  const route = read('src', 'app', 'api', 'attendance', 'no-show-sign-in', 'apply', 'route.ts');
  assert.match(route, /const RECHECK_DAYS = 7;/);
  assert.match(route, /await syncLatenessEntriesFromAttendanceForRange\(shiftDateKey\(date, -RECHECK_DAYS\), shiftDateKey\(date, -1\)\);/);
});

test('a debt pardon preview brings the last week up to date before totalling', () => {
  const route = read('src', 'app', 'api', 'payments', 'debt-pardon', 'route.ts');
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.ok(get.indexOf('syncLatenessEntriesFromAttendanceForRange(shiftDateKey(resolved.cutoffDate, -7), resolved.cutoffDate)') > 0);
  assert.ok(get.indexOf('syncLatenessEntriesFromAttendanceForRange') < get.indexOf('previewLatenessDebtPardon('));
});

test('charges are only rewritten or deleted if still unpaid and unpardoned at that moment', () => {
  const writes = read('src', 'lib', 'lateness-entry-writes.ts');
  assert.match(writes, /notExists\(\s*db\.select\(\{ one: sql`1` \}\)\.from\(latenessPaymentAllocation\)/);
  assert.match(writes, /notExists\(\s*db\.select\(\{ one: sql`1` \}\)\.from\(latenessDebtPardonEntry\)/);
  const files = [
    ['src', 'lib', 'attendance-lateness-sync.ts'],
    ['src', 'lib', 'staff-penalty-recalculation-server.ts'],
    ['src', 'lib', 'attendance-permission-reconciliation.ts'],
    ['src', 'app', 'api', 'entries', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'route.ts'],
  ];
  for (const parts of files) {
    const source = read(...parts);
    assert.doesNotMatch(source, /db\.delete\(latenessEntry\)/, parts.join('/'));
    assert.doesNotMatch(source, /db\.update\(latenessEntry\)/, parts.join('/'));
  }
});

test('permission changes set the day status from the times, and removing one re-applies a no sign-in', () => {
  const source = read('src', 'lib', 'attendance-permission-reconciliation.ts');
  assert.doesNotMatch(source, /'late' : 'present'/);
  assert.match(source, /status: attendanceStatusFor\(\{ arrivalTime, lateArrivalApproved: true \}\)/);
  assert.match(source, /status: attendanceStatusFor\(\{ arrivalTime \}\)/);
  assert.match(source, /if \(!input\.activePermission\) await applyNoShowSignInPenaltiesForDate\(input\.date\);/);
});

test('staff ever charged stay on Payments (also once attendance-only); others need a chargeable status', () => {
  const route = read('src', 'app', 'api', 'payments', 'lateness', 'route.ts');
  assert.match(route, /: or\(chargeableRoster, chargedStaff\);/);
  const page = read('src', 'app', 'payments', 'page.tsx');
  assert.doesNotMatch(page, /isAttendanceOnly !== true/);
});
