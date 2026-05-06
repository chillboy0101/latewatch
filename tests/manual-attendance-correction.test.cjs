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
