/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  getAttendanceStatusFlags,
} = require('../src/lib/attendance-status.ts');

test('late attendance with no sign-out keeps both status flags', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: false,
    attendanceStatus: 'late',
    fallbackStatus: 'not_checked_in',
    hasAttendance: true,
    noSignOut: true,
  }), ['late', 'no_sign_out']);
});

test('on-time attendance with no sign-out keeps the check-in status and no-sign-out flag', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: false,
    attendanceStatus: 'present',
    fallbackStatus: 'not_checked_in',
    hasAttendance: true,
    noSignOut: true,
  }), ['present', 'no_sign_out']);
});

test('absence permission overrides attendance issue flags', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: true,
    attendanceStatus: 'late',
    fallbackStatus: 'not_checked_in',
    hasAttendance: true,
    noSignOut: true,
  }), ['excused']);
});
