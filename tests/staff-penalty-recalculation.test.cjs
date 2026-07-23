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

test('regular staff recalculation updates old 09:01 penalties to the new clock-hour amount', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '09:01:00',
      computedAmount: '10.00',
      date: '2026-05-06',
      id: 'attendance-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    }],
    isNssPersonnel: false,
    latenessEntries: [{
      arrivalTime: '09:01:00',
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

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '15.00',
    id: 'attendance-1',
    reason: "DIDN'T COME BEFORE 8:30AM",
    status: 'late',
  }]);
  assert.deepEqual(plan.latenessUpdates, [{
    arrivalTime: '09:01',
    computedAmount: '15.00',
    didNotSignOut: false,
    id: 'entry-1',
    reason: "DIDN'T COME BEFORE 8:30AM",
  }]);
});

test('marking staff as attendance monitoring only clears stored penalties and lateness rows', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '10:31:00',
      computedAmount: '20.00',
      date: '2026-05-06',
      id: 'attendance-1',
      reason: "DIDN'T COME BEFORE 8:30AM",
      status: 'late',
    }],
    isAttendanceOnly: true,
    isNssPersonnel: false,
    latenessEntries: [{
      arrivalTime: '10:31:00',
      computedAmount: '20.00',
      date: '2026-05-06',
      didNotSignOut: true,
      id: 'entry-1',
      reason: "DIDN'T COME BEFORE 8:30AM AND DID NOT SIGN OUT",
      staffId: 'staff-1',
    }],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '0.00',
    id: 'attendance-1',
    reason: null,
    status: 'present',
  }]);
  assert.deepEqual(plan.latenessUpdates, []);
  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.latenessDeletes, [{ id: 'entry-1' }]);
});

test('staff penalty recalculation creates missing no-sign-out penalties from attendance records', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      date: '2026-05-06',
      id: 'attendance-1',
      reason: null,
      signOutTime: null,
      status: 'present',
    }],
    currentDateKey: '2026-05-07',
    currentTimeKey: '10:00',
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '2.00',
    id: 'attendance-1',
    reason: 'DID NOT SIGN OUT',
    status: 'late',
  }]);
  assert.deepEqual(plan.latenessCreates, [{
    arrivalTime: '08:05',
    computedAmount: '2.00',
    date: '2026-05-06',
    didNotSignOut: true,
    reason: 'DID NOT SIGN OUT',
    staffId: 'staff-1',
  }]);
});

test('staff penalty recalculation does not recreate waived no-sign-out penalties', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-06',
      id: 'attendance-1',
      noSignOutWaived: true,
      reason: 'DID NOT SIGN OUT',
      signOutTime: null,
      status: 'late',
    }],
    currentDateKey: '2026-05-07',
    currentTimeKey: '10:00',
    isNssPersonnel: false,
    latenessEntries: [{
      arrivalTime: '08:05',
      computedAmount: '2.00',
      date: '2026-05-06',
      didNotSignOut: true,
      id: 'entry-1',
      reason: 'DID NOT SIGN OUT',
      staffId: 'staff-1',
    }],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '0.00',
    id: 'attendance-1',
    reason: null,
    status: 'present',
  }]);
  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.latenessUpdates, []);
  assert.deepEqual(plan.latenessDeletes, [{ id: 'entry-1' }]);
});

test('staff penalty recalculation deletes duplicate no-sign-out rows for waived attendance', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-06',
      id: 'attendance-1',
      noSignOutWaived: true,
      reason: 'DID NOT SIGN OUT',
      signOutTime: null,
      status: 'late',
    }],
    currentDateKey: '2026-05-07',
    currentTimeKey: '10:00',
    isNssPersonnel: false,
    latenessEntries: [
      {
        arrivalTime: '08:05',
        computedAmount: '2.00',
        date: '2026-05-06',
        didNotSignOut: true,
        id: 'entry-1',
        reason: 'DID NOT SIGN OUT',
        staffId: 'staff-1',
      },
      {
        arrivalTime: '08:05',
        computedAmount: '2.00',
        date: '2026-05-06',
        didNotSignOut: true,
        id: 'entry-duplicate',
        reason: 'DID NOT SIGN OUT',
        staffId: 'staff-1',
      },
    ],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '0.00',
    id: 'attendance-1',
    reason: null,
    status: 'present',
  }]);
  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.latenessUpdates, []);
  assert.deepEqual(plan.latenessDeletes, [{ id: 'entry-1' }, { id: 'entry-duplicate' }]);
});

test('staff penalty recalculation creates no-show sign-in penalties for absent synthetic rows', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: null,
      computedAmount: '0.00',
      date: '2026-07-08',
      id: 'attendance-no-show',
      reason: null,
      status: 'absent',
    }],
    currentDateKey: '2026-07-08',
    currentTimeKey: '16:30',
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.latenessCreates, [{
    arrivalTime: null,
    computedAmount: '10.00',
    date: '2026-07-08',
    didNotSignOut: false,
    reason: "DIDN'T SIGN IN BEFORE 4:30PM",
    staffId: 'staff-1',
  }]);
});

test('staff penalty recalculation does not recreate waived no-show sign-in penalties', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: null,
      computedAmount: '0.00',
      date: '2026-07-08',
      id: 'attendance-no-show',
      noShowSignInWaived: true,
      reason: 'No-show waived',
      status: 'absent',
    }],
    currentDateKey: '2026-07-08',
    currentTimeKey: '16:30',
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.latenessUpdates, []);
});

test('staff penalty recalculation does not create no-show sign-in penalties before the rule took effect', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [{
      checkInTime: null,
      computedAmount: '0.00',
      date: '2026-05-06',
      id: 'attendance-no-show',
      reason: null,
      status: 'absent',
    }],
    currentDateKey: '2026-05-06',
    currentTimeKey: '16:30',
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'staff-1',
  });

  assert.deepEqual(plan.latenessCreates, []);
  assert.deepEqual(plan.attendanceUpdates, [{
    computedAmount: '0.00',
    id: 'attendance-no-show',
    reason: null,
    status: 'present',
  }]);
});
