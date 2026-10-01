/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { formatLeaveDuration, getActiveLeavePeriod, isStaffLeaveDate, leaveRangesOverlap } = require('../src/lib/staff-leave.ts');

test('leave coverage includes both approved range boundaries and excludes gaps', () => {
  const periods = [
    { endDate: '2026-09-10', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-09-01' },
    { endDate: '2026-09-20', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-09-15' },
  ];

  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-01'), true);
  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-10'), true);
  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-13'), false);
  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-15'), true);
  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-20'), true);
  assert.equal(isStaffLeaveDate(periods, 'staff-2', '2026-09-01'), false);
});

test('legacy staff-status periods do not count as approved leave', () => {
  assert.equal(isStaffLeaveDate([
    { endDate: null, source: 'staff_status', staffId: 'staff-1', startDate: '2026-09-01' },
  ], 'staff-1', '2026-09-30'), false);
});

test('actual return date is the first non-leave day', () => {
  const periods = [
    { endDate: '2026-09-30', returnedOn: '2026-09-20', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-09-01' },
  ];

  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-19'), true);
  assert.equal(isStaffLeaveDate(periods, 'staff-1', '2026-09-20'), false);
});

test('range overlap is inclusive and returned periods end before the return date', () => {
  const base = {
    existingEndDate: '2026-09-10',
    existingStartDate: '2026-09-01',
  };

  assert.equal(leaveRangesOverlap({ ...base, startDate: '2026-09-10', endDate: '2026-09-12' }), true);
  assert.equal(leaveRangesOverlap({ ...base, startDate: '2026-09-11', endDate: '2026-09-12' }), false);
  assert.equal(leaveRangesOverlap({ ...base, existingReturnedOn: '2026-09-08', startDate: '2026-09-08', endDate: '2026-09-12' }), false);
});

test('current leave period and duration are computed using the effective end date', () => {
  const periods = [
    { endDate: '2026-09-30', returnedOn: '2026-09-20', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-09-01' },
    { endDate: '2026-10-05', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-10-01' },
  ];

  const currentPeriod = getActiveLeavePeriod(periods, 'staff-1', '2026-09-18');
  assert.deepEqual(currentPeriod, periods[0]);
  assert.equal(formatLeaveDuration(periods[0], '2026-09-18'), '18 days');
  assert.equal(formatLeaveDuration(periods[1], '2026-10-02'), '2 days');
});