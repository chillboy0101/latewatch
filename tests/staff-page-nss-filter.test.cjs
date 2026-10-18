/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staffPagePath = path.join(__dirname, '../src/app/staff/page.tsx');
const attendanceOverviewPath = path.join(__dirname, '../src/app/attendance/overview/page.tsx');
const staffRoutePath = path.join(__dirname, '../src/app/api/staff/route.ts');
const staffUpdateRoutePath = path.join(__dirname, '../src/app/api/staff/[id]/route.ts');
const schemaPath = path.join(__dirname, '../src/db/schema.ts');
const migrationPath = path.join(__dirname, '../drizzle/0022_staff_leave_periods.sql');
const metadataRepairMigrationPath = path.join(__dirname, '../drizzle/0026_restore_staff_profile_metadata.sql');
const seedMigrationPath = path.join(__dirname, '../src/app/api/seed/migrate/route.ts');

test('staff page exposes a top-level NSS personnel filter', () => {
  const source = fs.readFileSync(staffPagePath, 'utf8');

  assert.match(source, /type StaffFilter = 'all' \| 'active' \| 'onLeave' \| 'inactive' \| 'former' \| 'nss'/);
  assert.match(source, /staffFilter === 'nss'/);
  assert.match(source, /label: 'NSS Personnel'/);
});

test('staff page shows interns and special staff as their own types and sections', () => {
  const source = fs.readFileSync(staffPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly: boolean/);
  assert.match(source, /type StaffFilter = 'all' \| 'active' \| 'onLeave' \| 'inactive' \| 'former' \| 'nss' \| 'intern' \| 'special'/);
  assert.match(source, /label: 'Interns'/);
  assert.match(source, /label: 'Special Staff'/);
  assert.match(source, /grid auto-cols-\[minmax\(10\.5rem,1fr\)\] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-8/);
  assert.doesNotMatch(source, /xl:grid-cols-5/);
  assert.match(source, /title: 'Main Staff'/);
  assert.match(source, /title: 'NSS Personnel'/);
  assert.match(source, /title: 'Special Staff \(not charged\)'/);
  assert.match(source, /title: 'Interns \(not charged\)'/);
  assert.match(source, /<StaffTypeField id="new-staff-type" value=\{newStaffType\} onChange=\{setNewStaffType\} \/>/);
  assert.match(source, /<StaffField label="Type" value=\{STAFF_TYPE_LABELS\[staffTypeOf\(member\)\]\} \/>/);
})

test('staff page and API expose attendance export metadata fields', () => {
  const pageSource = fs.readFileSync(staffPagePath, 'utf8');
  const createSource = fs.readFileSync(staffRoutePath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');

  for (const field of ['staffNo', 'gender', 'rank']) {
    assert.match(pageSource, new RegExp(`${field}: string \\| null`));
    assert.match(createSource, new RegExp(`${field}: staff\\.${field}`));
    assert.match(updateSource, new RegExp(`${field}\\?: string \\| null`));
  }

  assert.match(pageSource, /Staff No\./);
  assert.match(pageSource, /Gender/);
  assert.match(pageSource, /Rank/);
  assert.match(pageSource, /addStaffMissingRequiredMetadata/);
  assert.match(pageSource, /required=\{newIsMainStaff\}/);
  assert.match(createSource, /Gender is required for staff profiles/);
  assert.match(createSource, /Staff No\. and Rank are required for main staff profiles/);
});

test('staff profile metadata is not wiped by blank edit submissions', () => {
  const pageSource = fs.readFileSync(staffPagePath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');

  assert.match(updateSource, /function applyProfileMetadataUpdate/);
  assert.match(updateSource, /if \(normalized \|\| !previousValue\)/);
  assert.match(updateSource, /applyProfileMetadataUpdate\(updateData, 'staffNo', staffNo, before\.staffNo\)/);
  assert.match(updateSource, /applyProfileMetadataUpdate\(updateData, 'gender', gender, before\.gender\)/);
  assert.match(updateSource, /applyProfileMetadataUpdate\(updateData, 'rank', rank, before\.rank\)/);
  assert.doesNotMatch(updateSource, /if \(staffNo !== undefined\) updateData\.staffNo =/);
  assert.doesNotMatch(updateSource, /if \(gender !== undefined\) updateData\.gender =/);
  assert.doesNotMatch(updateSource, /if \(rank !== undefined\) updateData\.rank =/);
  assert.match(pageSource, /if \(response\.ok\) \{\s*await fetchStaff\(\);/);
});

test('staff metadata repair can restore missing fields from audit history', () => {
  assert.equal(fs.existsSync(metadataRepairMigrationPath), true);
  const seedMigrationSource = fs.readFileSync(seedMigrationPath, 'utf8');
  const metadataRepairMigrationSource = fs.readFileSync(metadataRepairMigrationPath, 'utf8');

  for (const source of [seedMigrationSource, metadataRepairMigrationSource]) {
    assert.match(source, /staff_profile_restore/);
    assert.match(source, /before_json->>'staffNo'/);
    assert.match(source, /before_json->>'gender'/);
    assert.match(source, /before_json->>'rank'/);
    assert.match(source, /after_json->>'staffNo'/);
    assert.match(source, /NULLIF\(trim\(COALESCE\(staff\.staff_no, ''\)\), ''\) IS NULL/);
  }
});

test('staff page omits removed manual message fields', () => {
  const source = fs.readFileSync(staffPagePath, 'utf8');
  const lowerFeature = ['what', 'sapp'].join('');
  const displayFeature = ['Whats', 'App'].join('');

  assert.doesNotMatch(source, new RegExp(`${lowerFeature}Phone`));
  assert.doesNotMatch(source, new RegExp(`${lowerFeature}NotificationsEnabled`));
  assert.doesNotMatch(source, new RegExp(`${displayFeature} Number`));
});

test('staff API omits removed manual message fields', () => {
  const createSource = fs.readFileSync(staffRoutePath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');
  const lowerFeature = ['what', 'sapp'].join('');
  const displayFeature = ['Whats', 'App'].join('');

  assert.doesNotMatch(createSource, new RegExp(`${lowerFeature}Phone`));
  assert.doesNotMatch(createSource, new RegExp(`${lowerFeature}NotificationsEnabled`));
  assert.doesNotMatch(createSource, new RegExp(`valid ${displayFeature} number`));
  assert.doesNotMatch(updateSource, new RegExp(`${lowerFeature}Phone`));
  assert.doesNotMatch(updateSource, new RegExp(`${lowerFeature}NotificationsEnabled`));
  assert.doesNotMatch(updateSource, new RegExp(`valid ${displayFeature} number`));
});

test('staff status updates do not mutate independent leave periods', () => {
  const schemaSource = fs.readFileSync(schemaPath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const seedMigrationSource = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.match(schemaSource, /export const staffLeavePeriod = pgTable\('staff_leave_period'/);
  assert.match(schemaSource, /startDate: date\('start_date'\)\.notNull\(\)/);
  assert.match(schemaSource, /endDate: date\('end_date'\)/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS staff_leave_period/);
  assert.match(seedMigrationSource, /CREATE TABLE IF NOT EXISTS staff_leave_period/);

  assert.doesNotMatch(updateSource, /recordStaffLeaveTransition/);
  assert.doesNotMatch(updateSource, /endLeavePeriod/);
  assert.match(updateSource, /action: auditAction/);
  assert.match(updateSource, /before,/);
  assert.match(updateSource, /: updated\[0\],\n\s+reason: 'staff'/);
  assert.match(updateSource, /reason: 'staff'/);
});

test('staff page keeps leave management separate from employment status', () => {
  const pageSource = fs.readFileSync(staffPagePath, 'utf8');

  assert.match(pageSource, /label: 'On Leave'/);
  assert.match(pageSource, /<StaffLeaveDialog/);
  assert.match(pageSource, /member\.active \? 'Deactivate' : 'Activate'/);
  assert.doesNotMatch(pageSource, /Put on leave/);
  assert.doesNotMatch(pageSource, /Return from leave/);
  assert.doesNotMatch(pageSource, /endLeavePeriod: true/);
});

test('attendance permissions distinguish date-based absence from ongoing leave', () => {
  const source = fs.readFileSync(attendanceOverviewPath, 'utf8');

  assert.match(source, /Manage ongoing leave/);
  assert.doesNotMatch(source, /Excused absence applies to these dates only/);
  assert.match(source, /<StaffLeaveDialog/);
});

test('staff API flags current leave periods separately from staff active status', () => {
  const source = fs.readFileSync(staffRoutePath, 'utf8');

  assert.match(source, /from\(staffLeavePeriod\)/);
  assert.match(source, /lte\(staffLeavePeriod\.startDate, currentDate\)/);
  assert.match(source, /gte\(staffLeavePeriod\.endDate, currentDate\)/);
  assert.match(source, /onLeave: member\.archived !== true && Boolean\(activeLeave\)/);
});

test('one shared leave dialog approves, extends and closes any open leave', () => {
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/attendance/staff-leave-dialog.tsx'), 'utf8');
  const patchRoute = fs.readFileSync(path.join(__dirname, '../src/app/api/attendance/leave/[id]/route.ts'), 'utf8');

  assert.match(dialog, /Approve leave/);
  assert.match(dialog, /Change end date/);
  assert.match(dialog, /Record return/);
  assert.match(dialog, /label="Back at work on"/);
  assert.match(dialog, /Save end date/);
  assert.doesNotMatch(dialog, /type="date"/);
  // Leave recorded any way (backfill, permission, approved) can be closed or extended.
  assert.match(patchRoute, /ne\(staffLeavePeriod\.source, 'staff_status'\), isNull\(staffLeavePeriod\.returnedOn\)/);
  assert.doesNotMatch(patchRoute, /eq\(staffLeavePeriod\.source, 'approved_leave'\)/);
  assert.match(patchRoute, /excludeId: id/);
});

test('checking in while on leave ends the leave, and back-dated changes recalculate past days', () => {
  const checkIn = fs.readFileSync(path.join(__dirname, '../src/app/api/attendance/check-in/route.ts'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '../src/lib/staff-leave-return.ts'), 'utf8');
  const patchRoute = fs.readFileSync(path.join(__dirname, '../src/app/api/attendance/leave/[id]/route.ts'), 'utf8');

  assert.match(checkIn, /await endLeaveOnCheckIn\(\{/);
  assert.ok(checkIn.indexOf('await endLeaveOnCheckIn({') < checkIn.indexOf('entityId: createdAttendance.id'));
  assert.match(helper, /returnedOn: input\.date/);
  assert.match(helper, /reason: 'staff-leave-ended-by-check-in'/);
  assert.match(helper, /await syncLatenessEntriesFromAttendanceForRange\(startDate, lastDate\)/);
  assert.match(helper, /await applyNoShowSignInPenaltiesForRange\(startDate, lastDate\)/);
  assert.match(patchRoute, /await recalculateDaysAfterLeaveChange\(returnedOn, today\)/);
  assert.match(patchRoute, /await recalculateDaysAfterLeaveChange\(nextDateKey\(earlier\), later\)/);
});

test('archiving staff releases their LateWatch sign-in seat and restoring invites them back', () => {
  const route = fs.readFileSync(staffUpdateRoutePath, 'utf8');
  const clerk = fs.readFileSync(path.join(__dirname, '../src/lib/clerk-organization.ts'), 'utf8');

  // Archive (PUT archived:true and DELETE without permanent) frees the organisation seat.
  assert.match(route, /if \(updated\[0\]\.archived === true\) \{/);
  assert.match(route, /unlinkStaffEmailIdentity\(\{ email: staffEmail, releaseSeat: true, staffId: id \}\)/);
  assert.match(route, /unlinkStaffEmailIdentity\(\{ email: before\.email, releaseSeat: true, staffId: id \}\)/);
  assert.match(route, /reason: 'clerk-organization-seat-released'/);
  // Restoring falls through to the normal sync, which re-adds or re-invites them.
  assert.match(route, /\} else if \(nextEmail\) \{\s+await syncStaffEmailIdentity\(/);
  // Seat release also covers accounts that predate the LateWatch metadata.
  assert.match(clerk, /if \(!force && !ownsStaffRecord\(user, staffId\)\) return false;/);
  assert.match(clerk, /anyForEmail\s+\|\| asMetadata\(invitation\.privateMetadata\)\.latewatchStaffId === staffId/);
});
