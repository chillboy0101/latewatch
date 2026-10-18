/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const {
  allowedStaffTypes,
  canChangeStaffType,
  penaltyFlagsOn,
  staffTypeChangeError,
  staffTypeOf,
  staffTypeOn,
} = require('../src/lib/staff-type.ts');
const { planStaffPenaltyRecalculation } = require('../src/lib/staff-penalty-recalculation.ts');

// Ama: intern last year, NSS from 1 Mar, main staff from 1 Oct; archived 1-14 Jul in between.
const amaChanges = [
  { effectiveFrom: '2000-01-01', staffType: 'intern' },
  { effectiveFrom: '2026-03-01', staffType: 'nss' },
  { effectiveFrom: '2026-07-01', staffType: 'away' },
  { effectiveFrom: '2026-07-15', staffType: 'nss' },
  { effectiveFrom: '2026-10-01', staffType: 'main' },
];
const amaNow = { isAttendanceOnly: false, isNssPersonnel: false, staffType: 'main' };

test('the type on a day is the latest change on or before it', () => {
  assert.equal(staffTypeOn('2025-11-03', amaChanges, amaNow), 'intern');
  assert.equal(staffTypeOn('2026-02-28', amaChanges, amaNow), 'intern');
  assert.equal(staffTypeOn('2026-03-01', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-07-10', amaChanges, amaNow), 'away');
  assert.equal(staffTypeOn('2026-07-15', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-09-30', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-10-01', amaChanges, amaNow), 'main');
  // Out of order rows are still read by date.
  assert.equal(staffTypeOn('2026-05-01', [...amaChanges].reverse(), amaNow), 'nss');
});

test('people who never changed type keep their current rules on every day', () => {
  assert.equal(staffTypeOn('2024-01-01', [], amaNow), 'main');
  assert.deepEqual(penaltyFlagsOn('2024-01-01', undefined, { isAttendanceOnly: true, isNssPersonnel: false }), {
    isAttendanceOnly: true,
    isNssPersonnel: false,
  });
  assert.equal(staffTypeOf({ isAttendanceOnly: true }), 'special');
  assert.equal(staffTypeOf({ isNssPersonnel: true }), 'nss');
  assert.equal(staffTypeOf({ staffType: 'intern', isAttendanceOnly: true }), 'intern');
});

test('interns, special staff and away days are never charged; NSS skips the hourly charge', () => {
  assert.deepEqual(penaltyFlagsOn('2025-11-03', amaChanges, amaNow), { isAttendanceOnly: true, isNssPersonnel: false });
  assert.deepEqual(penaltyFlagsOn('2026-07-10', amaChanges, amaNow), { isAttendanceOnly: true, isNssPersonnel: false });
  assert.deepEqual(penaltyFlagsOn('2026-05-04', amaChanges, amaNow), { isAttendanceOnly: false, isNssPersonnel: true });
  assert.deepEqual(penaltyFlagsOn('2026-10-05', amaChanges, amaNow), { isAttendanceOnly: false, isNssPersonnel: false });
});

test('types only move forward and main staff is final', () => {
  assert.deepEqual(allowedStaffTypes('intern'), ['intern', 'nss', 'special', 'main']);
  assert.deepEqual(allowedStaffTypes('nss'), ['nss', 'special', 'main']);
  assert.deepEqual(allowedStaffTypes('special'), ['special', 'main']);
  assert.deepEqual(allowedStaffTypes('main'), ['main']);
  assert.equal(canChangeStaffType('special', 'main'), true);
  assert.equal(canChangeStaffType('nss', 'intern'), false);
  assert.equal(canChangeStaffType('main', 'special'), false);

  const today = '2026-10-18';
  assert.equal(staffTypeChangeError({ effectiveFrom: today, from: 'main', to: 'nss', today }), 'Main staff stay main staff.');
  assert.match(staffTypeChangeError({ effectiveFrom: today, from: 'special', to: 'nss', today }), /can only move on to Main staff/);
  assert.match(staffTypeChangeError({ effectiveFrom: '2026-10-19', from: 'intern', to: 'main', today }), /future/);
  assert.match(staffTypeChangeError({ effectiveFrom: '2026-09-01', from: 'nss', latestChangeDate: '2026-09-15', to: 'main', today }), /before 2026-09-15/);
  assert.equal(staffTypeChangeError({ effectiveFrom: '2026-09-15', from: 'nss', latestChangeDate: '2026-09-15', to: 'main', today }), null);
  assert.equal(staffTypeChangeError({ effectiveFrom: today, from: 'nss', to: 'nss', today }), null);
});

const lateDay = (date, id) => ({
  checkInTime: '10:31:00',
  computedAmount: '0.00',
  date,
  id,
  reason: null,
  signOutTime: '17:00:00',
  status: 'present',
});

test('a former intern made main staff from a date is charged only from that date', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [lateDay('2026-09-29', 'a1'), lateDay('2026-10-02', 'a2')],
    currentDateKey: '2026-10-18',
    currentTimeKey: '12:00:00',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'ama',
    typeChanges: [
      { effectiveFrom: '2000-01-01', staffType: 'intern' },
      { effectiveFrom: '2026-10-01', staffType: 'main' },
    ],
  });
  assert.deepEqual(plan.latenessCreates.map((entry) => [entry.date, entry.computedAmount]), [['2026-10-02', '20.00']]);
  // The intern day stays at no charge.
  assert.deepEqual(plan.attendanceUpdates.map((update) => [update.id, update.computedAmount]), [['a1', '0.00'], ['a2', '20.00']]);
});

test('NSS made special staff from a date keeps the NSS charges before it', () => {
  const entry = (date, id) => ({
    arrivalTime: '10:31:00', computedAmount: '10.00', date, didNotSignOut: false, id, reason: "DIDN'T COME BEFORE 8:30AM", staffId: 'kofi',
  });
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [lateDay('2026-09-29', 'a1'), lateDay('2026-10-02', 'a2')],
    currentDateKey: '2026-10-18',
    currentTimeKey: '12:00:00',
    isAttendanceOnly: true,
    isNssPersonnel: false,
    latenessEntries: [entry('2026-09-29', 'e1'), entry('2026-10-02', 'e2')],
    permissions: [],
    staffId: 'kofi',
    typeChanges: [
      { effectiveFrom: '2000-01-01', staffType: 'nss' },
      { effectiveFrom: '2026-10-01', staffType: 'special' },
    ],
  });
  assert.deepEqual(plan.latenessDeletes, [{ id: 'e2' }]);
  assert.deepEqual(plan.latenessUpdates, []);
});

test('the staff API checks type changes, saves them from a date and marks away days', () => {
  const update = read('src/app/api/staff/[id]/route.ts');
  const create = read('src/app/api/staff/route.ts');
  assert.match(update, /const typeError = staffTypeChangeError\(\{/);
  assert.match(update, /if \(nextType === 'main' && \(!nextStaffNo \|\| !nextRank\)\)/);
  assert.match(update, /staffType: 'away',/);
  assert.match(update, /effectiveFrom: nextDateKey\(today\),/);
  assert.match(update, /if \(typeChanged \|\| comingBack\) \{/);
  assert.match(update, /reason: 'staff-type-changed',/);
  // Archiving from the delete action is away too.
  assert.match(update, /effectiveFrom: nextDateKey\(getAccraDateKey\(\)\),/);
  // The same person comes back on the same profile (by email or name), never a second account.
  assert.match(create, /const existingStaff = existingByEmail \|\| existingByName;/);
  assert.match(create, /\$\{existingStaff\.fullName\} is archived\. \$\{typeError\}/);
  // The general pardon now respects people who are never charged.
  assert.match(read('src/app/api/attendance/permissions/general-pardon/route.ts'), /isAttendanceOnly: member\.isAttendanceOnly,/);
  const migration = read('drizzle/0038_staff_type_history.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_type_change/);
  assert.match(migration, /SELECT s\.id, 'away'/);
});
