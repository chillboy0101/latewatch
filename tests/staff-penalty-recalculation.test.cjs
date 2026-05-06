/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  planStaffPenaltyRecalculation,
} = require('../src/lib/staff-penalty-recalculation.ts');

test('marking staff as NSS recalculates stored attendance and lateness penalties to GHC 10', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '10:31:00',
      computedAmount: '20.00',
      date: '2026-05-06',
      id: 'attendance-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    }],
    isNssPersonnel: true,
    latenessEntries: [{
      arrivalTime: '10:31:00',
      computedAmount: '20.00',
      date: '2026-05-06',
      didNotSignOut: false,
      id: 'entry-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      staffId: 'staff-1',
    }],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '10.00',
    id: 'attendance-1',
    reason: "DIDN'T COME BEFORE 8:30AM",
    status: 'late',
  }]);
  assert.deepEqual(plan.latenessUpdates, [{
    arrivalTime: '10:31',
    computedAmount: '10.00',
    didNotSignOut: false,
    id: 'entry-1',
    reason: "DIDN'T COME BEFORE 8:30AM",
  }]);
  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.latenessDeletes, []);
});

test('switching NSS off restores regular staff hourly penalty', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '10:31:00',
      computedAmount: '10.00',
      date: '2026-05-06',
      id: 'attendance-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    }],
    isNssPersonnel: false,
    latenessEntries: [{
      arrivalTime: '10:31:00',
      computedAmount: '10.00',
      date: '2026-05-06',
      didNotSignOut: false,
      id: 'entry-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      staffId: 'staff-1',
    }],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.equal(plan.attendanceUpdates[0].computedAmount, '20.00');
  assert.equal(plan.latenessUpdates[0].computedAmount, '20.00');
});
