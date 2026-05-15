/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  mergeAttendanceRowsIntoEntryRows,
} = require('../src/lib/lateness-entry-presentation.ts');

test('pardoned late attendance rows still appear on the lateness entries page', () => {
  const rows = mergeAttendanceRowsIntoEntryRows({
    attendanceRows: [
      {
        id: 'attendance-1',
        checkInTime: '09:12:00',
        computedAmount: '0.00',
        createdAt: new Date('2026-05-06T09:12:00.000Z'),
        date: '2026-05-06',
        reason: 'Approved late arrival (Any time today): general pardon',
        staffId: 'staff-1',
        status: 'present',
        updatedAt: new Date('2026-05-06T09:30:00.000Z'),
      },
    ],
    entryRows: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].staffId, 'staff-1');
  assert.equal(rows[0].arrivalTime, '09:12:00');
  assert.equal(rows[0].computedAmount, '0.00');
  assert.equal(rows[0].reason, 'Approved late arrival (Any time today): general pardon');
});

test('stored lateness entries win over attendance fallback rows', () => {
  const rows = mergeAttendanceRowsIntoEntryRows({
    attendanceRows: [
      {
        id: 'attendance-1',
        checkInTime: '10:01:00',
        computedAmount: '20.00',
        createdAt: new Date('2026-05-06T10:01:00.000Z'),
        date: '2026-05-06',
        reason: "DIDN'T COME BEFORE 8:30AM",
        staffId: 'staff-1',
        status: 'late',
        updatedAt: new Date('2026-05-06T10:02:00.000Z'),
      },
    ],
    entryRows: [
      {
        id: 'entry-1',
        arrivalTime: '10:01:00',
        computedAmount: '20.00',
        createdAt: new Date('2026-05-06T10:01:00.000Z'),
        date: '2026-05-06',
        didNotSignOut: false,
        reason: "DIDN'T COME BEFORE 8:30AM",
        staffId: 'staff-1',
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'entry-1');
});

test('plain on-time attendance without a reason stays out of lateness entries', () => {
  const rows = mergeAttendanceRowsIntoEntryRows({
    attendanceRows: [
      {
        id: 'attendance-1',
        checkInTime: '08:10:00',
        computedAmount: '0.00',
        createdAt: new Date('2026-05-06T08:10:00.000Z'),
        date: '2026-05-06',
        reason: null,
        staffId: 'staff-1',
        status: 'present',
        updatedAt: new Date('2026-05-06T08:10:00.000Z'),
      },
    ],
    entryRows: [],
  });

  assert.equal(rows.length, 0);
});
