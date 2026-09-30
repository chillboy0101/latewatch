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

test('leave-only attendance replaces missing and expected penalty statuses', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: false,
    attendanceStatus: null,
    fallbackStatus: 'permission_overdue',
    hasAttendance: false,
    noSignOut: true,
    onLeave: true,
  }), ['on_leave']);
});

test('leave preserves actual late attendance but suppresses missing sign-out expectation', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: false,
    attendanceStatus: 'late',
    fallbackStatus: 'not_checked_in',
    hasAttendance: true,
    noSignOut: true,
    onLeave: true,
  }), ['late', 'on_leave']);
});

test('leave remains distinct alongside an approved date-based absence permission', () => {
  assert.deepEqual(getAttendanceStatusFlags({
    absencePermission: true,
    attendanceStatus: null,
    fallbackStatus: 'not_checked_in',
    hasAttendance: false,
    noSignOut: false,
    onLeave: true,
  }), ['excused', 'on_leave']);
});
