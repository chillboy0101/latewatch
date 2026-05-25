/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staffPagePath = path.join(__dirname, '../src/app/staff/page.tsx');
const staffRoutePath = path.join(__dirname, '../src/app/api/staff/route.ts');
const staffUpdateRoutePath = path.join(__dirname, '../src/app/api/staff/[id]/route.ts');
const staffActionsPath = path.join(__dirname, '../src/actions/staff.ts');
const schemaPath = path.join(__dirname, '../src/db/schema.ts');
const migrationPath = path.join(__dirname, '../drizzle/0022_staff_leave_periods.sql');
const seedMigrationPath = path.join(__dirname, '../src/app/api/seed/migrate/route.ts');

test('staff page exposes a top-level NSS personnel filter', () => {
  const source = fs.readFileSync(staffPagePath, 'utf8');

  assert.match(source, /type StaffFilter = 'all' \| 'active' \| 'inactive' \| 'former' \| 'nss'/);
  assert.match(source, /staffFilter === 'nss'/);
  assert.match(source, /label: 'NSS Personnel'/);
});

test('staff page keeps attendance monitoring only staff in a separate table section', () => {
  const source = fs.readFileSync(staffPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly: boolean/);
  assert.match(source, /type StaffFilter = 'all' \| 'active' \| 'inactive' \| 'former' \| 'nss' \| 'attendanceOnly'/);
  assert.match(source, /label: 'Monitoring Only'/);
  assert.match(source, /grid auto-cols-\[minmax\(10\.5rem,1fr\)\] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-6/);
  assert.doesNotMatch(source, /xl:grid-cols-5/);
  assert.match(source, /Main Staff/);
  assert.match(source, /NSS Personnel/);
  assert.match(source, /Attendance Monitoring Only/);
  assert.match(source, /mainFilteredStaff/);
  assert.match(source, /nssFilteredStaff/);
  assert.match(source, /attendanceOnlyFilteredStaff/);
});

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

test('staff leave periods are stored for deactivate and activate transitions', () => {
  const schemaSource = fs.readFileSync(schemaPath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');
  const actionsSource = fs.readFileSync(staffActionsPath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const seedMigrationSource = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.match(schemaSource, /export const staffLeavePeriod = pgTable\('staff_leave_period'/);
  assert.match(schemaSource, /startDate: date\('start_date'\)\.notNull\(\)/);
  assert.match(schemaSource, /endDate: date\('end_date'\)/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS staff_leave_period/);
  assert.match(seedMigrationSource, /CREATE TABLE IF NOT EXISTS staff_leave_period/);

  assert.match(updateSource, /recordStaffLeaveTransition/);
  assert.match(updateSource, /action: auditAction/);
  assert.match(updateSource, /before,/);
  assert.match(updateSource, /after: updated\[0\]/);
  assert.match(actionsSource, /recordStaffLeaveTransition/);
  assert.match(actionsSource, /actorEmail: user\.email/);
});
