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
  // Only the overlap codes count: a message that merely mentions "overlap" is a real failure.
  assert.equal(leaveOverlapError(new Error('Failed query: params: overlapping shift')), null);
  assert.equal(leaveOverlapError(null), null);
});

test('replaced permission days read naturally', () => {
  assert.equal(formatPermissionDays([]), '');
  assert.equal(formatPermissionDays(['2026-10-26']), '26 Oct');
  assert.equal(formatPermissionDays(['2026-10-15', '2026-10-30']), '15 Oct, 30 Oct');
  assert.equal(formatPermissionDays(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']), '26 Oct – 30 Oct (5 days)');
  // Gaps are never shown as a continuous run.
  assert.equal(formatPermissionDays(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-30']), '1 Oct, 8 Oct, 15 Oct, 30 Oct');
});

test('every leave type the app offers is one the database accepts', () => {
  const migration = read('drizzle/0031_staff_leave_type_and_return_date.sql');
  for (const type of STAFF_LEAVE_TYPES) assert.match(migration, new RegExp(`'${type.value}'`), type.value);
  assert.deepEqual(STAFF_LEAVE_TYPES.map((type) => type.value), ['annual', 'sick', 'maternity_paternity', 'study', 'other']);
});

test('approving or extending leave replaces permissions on its days in one transaction', () => {
  const post = read('src/app/api/attendance/leave/route.ts');
  const patch = read('src/app/api/attendance/leave/[id]/route.ts');
  for (const [file, route] of [['POST', post], ['PATCH', patch]]) {
    assert.match(route, /await db\.batch\(\[\n\s+deletePermissionsCoveredByLeave\(/, file);
    assert.match(route, /await auditReplacedPermissions\(/, file);
    assert.match(route, /findInactivePeriodOverlap\(/, file);
    // Only the save itself is mapped to an overlap message; later failures stay real errors.
    assert.match(route, /\} catch \(error\) \{\n\s+const overlapMessage = leaveOverlapError\(error\);\n\s+if \(overlapMessage\) return NextResponse\.json\(\{ error: overlapMessage \}, \{ status: 409 \}\);\n\s+throw error;/, file);
    // Every mapping sits right after a save and rethrows anything else.
    assert.equal(
      (route.match(/leaveOverlapError\(error\)/g) || []).length,
      (route.match(/if \(overlapMessage\) return NextResponse\.json\(\{ error: overlapMessage \}, \{ status: 409 \}\);\n\s+throw error;/g) || []).length,
      file,
    );
  }
  // A return wins over an end date sent with it; only a real extension replaces permissions.
  assert.match(patch, /const extending = !returnedOn && Boolean\(endDate\);/);
  assert.match(patch, /if \(extending\) \{\n\s+const \[deleted, \[updated\]\] = await db\.batch/);
  const service = read('src/lib/staff-leave-service.ts');
  // Deleted by date range (not ids read earlier), so a permission approved meanwhile goes too.
  assert.match(service, /db\.delete\(attendancePermission\)\n\s+\.where\(and\(\n\s+eq\(attendancePermission\.staffId, input\.staffId\),\n\s+eq\(attendancePermission\.status, 'approved'\),\n\s+gte\(attendancePermission\.date, input\.startDate\),\n\s+lte\(attendancePermission\.date, input\.endDate\),/);
  assert.match(service, /reason: 'replaced-by-leave'/);
  const dialog = read('src/components/attendance/staff-leave-dialog.tsx');
  assert.match(dialog, /withReplaced\('Leave approved\.'\)/);
  assert.match(dialog, /withReplaced\('End date updated\.'\)/);
});

test('the overlap rule only counts the days a leave actually ran', () => {
  const sql = read('drizzle/0039_leave_permission_overlap_effective_end.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION enforce_attendance_permission_non_overlap\(\)/);
  // Planned end, or the day before an earlier return; a late-recorded return never stretches it.
  assert.match(sql, /COALESCE\(LEAST\(existing_leave\.returned_on - 1, existing_leave\.end_date\), 'infinity'::date\)/);
  assert.doesNotMatch(sql, /COALESCE\(\w+\.returned_on - 1, \w+\.end_date/);
  assert.match(sql, /existing_leave\.source <> 'staff_status'/);
  assert.match(sql, /GREATEST\(NEW\.start_date, COALESCE\(LEAST\(NEW\.returned_on - 1/);
});

test('permissions and general pardons skip days already on leave or deactivated, instead of failing part-way', () => {
  const single = read('src/app/api/attendance/permissions/route.ts');
  const general = read('src/app/api/attendance/permissions/general-pardon/route.ts');
  for (const [name, route] of [['permissions', single], ['general pardon', general]]) {
    assert.match(route, /await getLeaveAndDeactivationCoverage\(\{/, name);
    // A leave or deactivation recorded meanwhile skips that day/person instead of a 500.
    assert.match(route, /if \(!isExcuseOverlapError\(error\)\) throw error;/, name);
  }
  assert.match(single, /skippedLeaveDays: formatPermissionDays/);
  assert.match(single, /so no permission can be added for those days/);
  assert.match(general, /skippedCount: skippedPermissions\.length,/);
  const page = read('src/app/attendance/overview/page.tsx');
  assert.match(page, /Skipped \$\{body\.skippedLeaveDays\}: already on leave\./);
  const service = read('src/lib/staff-leave-service.ts');
  assert.match(service, /if \(isStaffLeaveDate\(periods, staffId, date\)\) return 'leave';/);
});

test('a leave with wrong dates or type can be corrected or removed, and its days recalculated', () => {
  const route = read('src/app/api/attendance/leave/[id]/route.ts');
  // Correction: any leave (open or ended), new days take over permissions in one transaction.
  assert.match(route, /if \(body\?\.correct === true\) return await correctLeave\(id, body, actorOf\(user\)\);/);
  assert.match(route, /\.set\(\{ endDate, leaveType: leaveType as StaffLeaveType, startDate, updatedAt: new Date\(\) \}\)/);
  assert.match(route, /deletePermissionsCoveredByLeave\(\{ endDate: coveredEnd, staffId, startDate \}\)/);
  assert.match(route, /reason: 'staff-leave-corrected'/);
  // Only changed dates recalculate, old range and new range each (a type-only fix changes no charge).
  assert.match(route, /if \(datesChanged\) \{\n\s+await recalculateDaysAfterLeaveChange\(before\.startDate, oldEnd\);\n\s+await recalculateDaysAfterLeaveChange\(startDate, coveredEnd\);/);
  // "No end date" stays possible when correcting.
  assert.match(route, /const endDate = openEnded \? null :/);
  // Days the leave no longer covers get back the permissions it replaced (correct, shorten, return, remove).
  assert.equal((route.match(/await restorePermissionsReplacedByLeave\(\{/g) || []).length, 3);
  assert.match(route, /They were back at work on \$\{before\.returnedOn\}, so the leave must start before that\./);
  // Removal: its days go back to normal and are recalculated; status rows can't be removed here.
  assert.match(route, /export async function DELETE\(/);
  assert.match(route, /reason: 'staff-leave-removed'/);
  assert.match(route, /await recalculateDaysAfterLeaveChange\(before\.startDate, getEffectiveLeaveEndDate\(before\) \|\| getAccraDateKey\(\)\);/);
  assert.equal((route.match(/ne\(staffLeavePeriod\.source, 'staff_status'\)/g) || []).length, 3);

  const list = read('src/app/api/attendance/leave/route.ts');
  assert.match(list, /url\.searchParams\.get\('history'\) === '1'/);
  const dialog = read('src/components/attendance/staff-leave-dialog.tsx');
  assert.match(dialog, /Correct this leave/);
  assert.match(dialog, /Earlier leave/);
  assert.match(dialog, /body: JSON\.stringify\(\{ correct: true, endDate: openEnded \? null : endDate, leaveType, openEnded, startDate \}\)/);
  assert.match(dialog, /\{confirmRemove \? 'Tap again to remove' : 'Remove leave'\}/);
  assert.match(dialog, /No end date \(till further notice\)/);
  // A slower history answer for a previously selected person is ignored.
  assert.match(dialog, /if \(historyFor\.current === forStaffId\) setHistory/);
});

test('editing a permission to another date or person removes the old one and recalculates its day', () => {
  const route = read('src/app/api/attendance/permissions/route.ts');
  assert.match(route, /const keptInPlace = old && permissions\.some\(\(saved\) => saved\.id === old\.id\);/);
  assert.match(route, /if \(old && !keptInPlace\) \{\n\s+await db\.delete\(attendancePermission\)/);
  assert.match(route, /reason: 'attendance-permission-corrected'/);
  assert.match(route, /activePermission: null,/);
  const page = read('src/app/attendance/overview/page.tsx');
  assert.equal((page.match(/replacesPermissionId,/g) || []).length, 2);
});

test('replaced permissions are tied to their leave and restored only on days it no longer covers', () => {
  const service = read('src/lib/staff-leave-service.ts');
  assert.match(service, /before: \{ \.\.\.permission, replacedByLeaveId: input\.leaveId,/);
  assert.match(service, /before_json->>'replacedByLeaveId' = \$\{input\.leaveId\}/);
  assert.match(service, /!input\.keep \|\| date < input\.keep\.startDate \|\| date > input\.keep\.endDate/);
  assert.match(service, /if \(coverage\(input\.staffId, date\)\) continue;/);
  assert.match(service, /\.onConflictDoNothing\(\)/);
  assert.match(service, /reason: 'restored-after-leave-change'/);
  const patch = read('src/app/api/attendance/leave/[id]/route.ts');
  assert.match(patch, /keep: \{ endDate: getEffectiveLeaveEndDate\(period\) \|\| '9999-12-31', startDate: period\.startDate \}/);
});

test('a permission is skipped as "on leave" only for the one-excuse-per-day refusal, not a duplicate', () => {
  const { isExcuseOverlapError } = require('../src/lib/staff-leave.ts');
  const wrap = (code) => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('x'), { code }) });
  assert.equal(isExcuseOverlapError(wrap('23P01')), true);
  assert.equal(isExcuseOverlapError(wrap('23505')), false);
  assert.equal(isExcuseOverlapError(new Error('nope')), false);
  for (const file of ['src/app/api/attendance/permissions/route.ts', 'src/app/api/attendance/permissions/general-pardon/route.ts']) {
    assert.match(read(file), /if \(!isExcuseOverlapError\(error\)\) throw error;/, file);
  }
  const route = read('src/app/api/attendance/permissions/route.ts');
  assert.match(route, /appliedDates = permissions\.map\(\(saved\) => String\(saved\.date\)\.slice\(0, 10\)\);/);
  // Screens refresh after an edit's old permission is removed, not before.
  assert.ok(route.indexOf("reason: 'attendance-permission-corrected'") < route.indexOf("publishRealtime('dashboard'"));
  const page = read('src/app/attendance/overview/page.tsx');
  assert.doesNotMatch(page, /disabled=\{isEditingPermission\}/);
});
