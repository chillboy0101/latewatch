/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staffPagePath = path.join(__dirname, '../src/app/staff/page.tsx');
const staffRoutePath = path.join(__dirname, '../src/app/api/staff/route.ts');
const staffUpdateRoutePath = path.join(__dirname, '../src/app/api/staff/[id]/route.ts');

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
  assert.match(source, /Attendance Monitoring Only/);
  assert.match(source, /regularFilteredStaff/);
  assert.match(source, /attendanceOnlyFilteredStaff/);
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
