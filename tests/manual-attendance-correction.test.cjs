/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  manualAttendanceCorrectionChanged,
  resolveManualAttendanceCorrection,
} = require('../src/lib/manual-attendance-correction.ts');

test('manual attendance correction rewrites a late check-in to the corrected on-time value', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T09:12:00.000Z'),
      checkInTime: '09:12:00',
      computedAmount: '10.00',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    },
    arrivalTime: '08:05',
    date: '2026-05-06',
    didNotSignOut: false,
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05',
    computedAmount: '0.00',
    reason: null,
    status: 'present',
  });

  assert.equal(manualAttendanceCorrectionChanged({
    attendance: {
      checkInAt: new Date('2026-05-06T09:12:00.000Z'),
      checkInTime: '09:12:00',
      computedAmount: '10.00',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    },
    correction,
  }), true);
});

test('manual attendance correction keeps an on-time check-in but adds the no-sign-out penalty', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T08:05:00.000Z'),
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      reason: null,
      status: 'present',
    },
    arrivalTime: null,
    date: '2026-05-06',
    didNotSignOut: true,
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05',
    computedAmount: '2.00',
    reason: 'DID NOT SIGN OUT',
    status: 'late',
  });
});

test('manual attendance correction records a real sign-out time', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T08:05:00.000Z'),
      checkInTime: '08:05:00',
      computedAmount: '2.00',
      reason: 'DID NOT SIGN OUT',
      signOutAt: null,
      signOutTime: null,
      status: 'late',
    },
    arrivalTime: '08:05',
    date: '2026-05-06',
    didNotSignOut: false,
    signOutCorrection: 'set',
    signOutTime: '16:50',
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05',
    computedAmount: '0.00',
    reason: null,
    signOutAt: new Date('2026-05-06T16:50:00.000Z'),
    signOutTime: '16:50',
    status: 'present',
  });
});

test('manual attendance correction clears a sign-out time without creating a fake fallback', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T08:05:00.000Z'),
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      reason: null,
      signOutAt: new Date('2026-05-06T16:45:00.000Z'),
      signOutTime: '16:45:00',
      status: 'present',
    },
    arrivalTime: '08:05',
    date: '2026-05-06',
    didNotSignOut: true,
    signOutCorrection: 'clear',
  });

  assert.equal(correction.signOutTime, null);
  assert.equal(correction.signOutAt, null);
  assert.equal(correction.computedAmount, '2.00');
  assert.equal(correction.reason, 'DID NOT SIGN OUT');
});

test('manual attendance correction applies the NSS flat late penalty', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T10:31:00.000Z'),
      checkInTime: '10:31:00',
      computedAmount: '20.00',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    },
    arrivalTime: '10:31',
    date: '2026-05-06',
    didNotSignOut: false,
    isNssPersonnel: true,
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T10:31:00.000Z'),
    checkInTime: '10:31',
    computedAmount: '10.00',
    reason: "DIDN'T COME BEFORE 8:30AM",
    status: 'late',
  });
});

test('manual attendance correction clears penalties for attendance monitoring only staff', () => {
  const correction = resolveManualAttendanceCorrection({
    attendance: {
      checkInAt: new Date('2026-05-06T10:31:00.000Z'),
      checkInTime: '10:31:00',
      computedAmount: '20.00',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    },
    arrivalTime: '10:31',
    date: '2026-05-06',
    didNotSignOut: true,
    isAttendanceOnly: true,
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T10:31:00.000Z'),
    checkInTime: '10:31',
    computedAmount: '0.00',
    reason: null,
    status: 'present',
  });
});

test('manual attendance correction keeps approved general late pardons at zero penalty', () => {
  const correction = resolveManualAttendanceCorrection({
    activePermission: {
      arrivalWindow: 'any_time_today',
      expectedEndTime: '23:59',
      expectedStartTime: '00:00',
      permissionType: 'late_arrival',
      reason: 'general pardon',
      status: 'approved',
    },
    attendance: {
      checkInAt: new Date('2026-05-06T09:12:00.000Z'),
      checkInTime: '09:12:00',
      computedAmount: '0.00',
      reason: 'Approved late arrival (Any time today): general pardon',
      status: 'present',
    },
    arrivalTime: '10:31',
    date: '2026-05-06',
    didNotSignOut: false,
  });

  assert.deepEqual(correction, {
    checkInAt: new Date('2026-05-06T10:31:00.000Z'),
    checkInTime: '10:31',
    computedAmount: '0.00',
    reason: 'Approved late arrival (Any time today): general pardon',
    status: 'present',
  });
});
