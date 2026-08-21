/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { summarizeEntryDay } = require('../src/lib/entry-day-summary.ts');

function entry(overrides = {}) {
  return {
    amount: 0,
    arrivalTime: null,
    didNotSignOut: false,
    isExcusedAbsence: false,
    isGeneralPardon: false,
    isOnLeave: false,
    noShowSignInWaived: false,
    noSignOutWaived: false,
    ...overrides,
  };
}

test('entry day summary does not count blank rows as on time', () => {
  const summary = summarizeEntryDay([
    entry(),
    entry({ isOnLeave: true }),
    entry({ isExcusedAbsence: true }),
  ]);

  assert.equal(summary.totalStaff, 3);
  assert.equal(summary.notCheckedIn, 1);
  assert.equal(summary.onTime, 0);
  assert.equal(summary.onLeave, 1);
  assert.equal(summary.excused, 1);
});

test('entry day summary includes attendance and administrative statuses', () => {
  const summary = summarizeEntryDay([
    entry({ arrivalTime: '08:25', amount: 0 }),
    entry({ arrivalTime: '09:15', amount: 10 }),
    entry({ arrivalTime: '08:20', didNotSignOut: true, amount: 10 }),
    entry({ noShowSignInWaived: true }),
    entry({ isGeneralPardon: true }),
  ]);

  assert.equal(summary.onTime, 2);
  assert.equal(summary.late, 1);
  assert.equal(summary.noSignOut, 1);
  assert.equal(summary.waived, 1);
  assert.equal(summary.generalPardon, 1);
  assert.equal(summary.notCheckedIn, 0);
  assert.equal(summary.totalAmount, 20);
});
