/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staffPagePath = path.join(__dirname, '../src/app/staff/page.tsx');

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
