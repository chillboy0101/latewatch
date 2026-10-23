/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const { formatPermissionDays, leaveOverlapError, STAFF_LEAVE_TYPES } = require('../src/lib/staff-leave.ts');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a database overlap refusal becomes a clear message, wrapped or not', () => {
  const neonError = Object.assign(new Error('attendance_permission_overlap'), { code: '23P01' });
  const wrapped = Object.assign(new Error('Failed query: insert into "staff_leave_period"'), { cause: neonError });
  assert.match(leaveOverlapError(wrapped), /overlap another leave period, or a time this person was deactivated/);
  assert.ok(leaveOverlapError(neonError));
  assert.ok(leaveOverlapError(Object.assign(new Error('dup'), { code: '23505' })));
  assert.equal(leaveOverlapError(new Error('connection reset')), null);
  assert.equal(leaveOverlapError(null), null);
});

test('replaced permission days read naturally', () => {
  assert.equal(formatPermissionDays([]), '');
  assert.equal(formatPermissionDays(['2026-10-26']), '26 Oct');
  assert.equal(formatPermissionDays(['2026-10-15', '2026-10-30']), '15 Oct, 30 Oct');
  assert.equal(formatPermissionDays(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']), '26 Oct – 30 Oct (5 days)');
});

test('every leave type the app offers is one the database accepts', () => {
  const migration = read('drizzle/0031_staff_leave_type_and_return_date.sql');
  for (const type of STAFF_LEAVE_TYPES) assert.match(migration, new RegExp(`'${type.value}'`), type.value);
  assert.deepEqual(STAFF_LEAVE_TYPES.map((type) => type.value), ['annual', 'sick', 'maternity_paternity', 'study', 'other']);
});

test('approving or extending leave replaces permissions on its days in one transaction', () => {
  for (const file of ['src/app/api/attendance/leave/route.ts', 'src/app/api/attendance/leave/[id]/route.ts']) {
    const route = read(file);
    assert.match(route, /getPermissionsCoveredByLeave\(/, file);
    assert.match(route, /await db\.batch\(\[\n\s+db\.delete\(attendancePermission\)/, file);
    assert.match(route, /reason: 'replaced-by-leave'/, file);
    assert.match(route, /findInactivePeriodOverlap\(/, file);
    assert.match(route, /const overlapMessage = leaveOverlapError\(error\)/, file);
  }
  const service = read('src/lib/staff-leave-service.ts');
  assert.match(service, /eq\(attendancePermission\.status, 'approved'\)/);
  const dialog = read('src/components/attendance/staff-leave-dialog.tsx');
  assert.match(dialog, /withReplaced\('Leave approved\.'\)/);
  assert.match(dialog, /withReplaced\('End date updated\.'\)/);
});

test('the overlap rule only counts the days a leave actually ran', () => {
  const sql = read('drizzle/0039_leave_permission_overlap_effective_end.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION enforce_attendance_permission_non_overlap\(\)/);
  assert.match(sql, /COALESCE\(existing_leave\.returned_on - 1, existing_leave\.end_date, 'infinity'::date\)/);
  assert.match(sql, /existing_leave\.source <> 'staff_status'/);
  assert.match(sql, /GREATEST\(NEW\.start_date, COALESCE\(NEW\.returned_on - 1/);
});
