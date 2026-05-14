/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const attendancePagePath = path.join(__dirname, '../src/app/attendance/page.tsx');
const attendanceRoutePath = path.join(__dirname, '../src/app/api/attendance/route.ts');

test('attendance table separates main staff, NSS personnel, and monitoring-only staff', () => {
  const pageSource = fs.readFileSync(attendancePagePath, 'utf8');
  const routeSource = fs.readFileSync(attendanceRoutePath, 'utf8');

  assert.match(routeSource, /isAttendanceOnly: staff\.isAttendanceOnly/);
  assert.match(pageSource, /isAttendanceOnly\?: boolean \| null/);
  assert.match(pageSource, /mainAttendanceRows/);
  assert.match(pageSource, /nssAttendanceRows/);
  assert.match(pageSource, /monitoringOnlyAttendanceRows/);
  assert.match(pageSource, /Main Staff/);
  assert.match(pageSource, /NSS Personnel/);
  assert.match(pageSource, /Attendance Monitoring Only/);
});
