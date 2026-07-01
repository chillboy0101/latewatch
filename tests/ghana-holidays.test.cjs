/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  applyGhanaHolidayOverrides,
  getObservedGhanaHolidayForDate,
  getSuppressedGhanaHolidayDatesForScope,
  isSuppressedGhanaHolidayDate,
} = require('../src/lib/ghana-holidays.ts');

test('Republic Day 2026 is observed on July 3, not July 1', () => {
  assert.equal(isSuppressedGhanaHolidayDate('2026-07-01'), true);
  assert.equal(isSuppressedGhanaHolidayDate('2026-07-03'), false);
  assert.deepEqual(getObservedGhanaHolidayForDate('2026-07-03'), {
    date: '2026-07-03',
    name: 'Republic Day',
    source: 'google',
  });
});

test('Ghana holiday sync corrections replace stale July 1 with July 3', () => {
  const holidays = applyGhanaHolidayOverrides([
    { date: '2026-07-01', name: 'Republic Day', source: 'google' },
    { date: '2026-09-21', name: 'Founders Day', source: 'google' },
  ], { year: 2026 });

  assert.deepEqual(holidays, [
    { date: '2026-07-03', name: 'Republic Day', source: 'google' },
    { date: '2026-09-21', name: 'Founders Day', source: 'google' },
  ]);
});

test('suppressed holiday dates are scoped by year and month', () => {
  assert.deepEqual(getSuppressedGhanaHolidayDatesForScope({ year: 2026 }), ['2026-07-01']);
  assert.deepEqual(getSuppressedGhanaHolidayDatesForScope({ year: 2026, month: 6 }), ['2026-07-01']);
  assert.deepEqual(getSuppressedGhanaHolidayDatesForScope({ year: 2026, month: 8 }), []);
  assert.deepEqual(getSuppressedGhanaHolidayDatesForScope({ year: 2025 }), []);
});
