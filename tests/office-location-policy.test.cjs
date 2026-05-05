/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const officeLocationPolicy = require('../src/lib/office-location-policy.ts');

const resolveOfficeLocationForDate = officeLocationPolicy.resolveOfficeLocationForDate || (() => null);
const overlapsOfficeLocationSchedule = officeLocationPolicy.overlapsOfficeLocationSchedule || (() => false);

const defaultOffice = {
  id: 'default-office',
  isActive: true,
  locationKind: 'default',
  name: 'GRA Office',
  scheduleEndDate: null,
  scheduleStartDate: null,
  updatedAt: new Date('2026-05-01T08:00:00.000Z'),
};

const programLocation = {
  id: 'program-location',
  isActive: true,
  locationKind: 'scheduled',
  name: 'Leadership Program',
  scheduleEndDate: '2026-05-08',
  scheduleStartDate: '2026-05-06',
  updatedAt: new Date('2026-05-02T08:00:00.000Z'),
};

test('default office is used when no scheduled program covers the date', () => {
  const resolved = resolveOfficeLocationForDate([defaultOffice, programLocation], '2026-05-05');

  assert.equal(resolved?.id, 'default-office');
});

test('scheduled program location overrides default office for covered dates', () => {
  const resolved = resolveOfficeLocationForDate([defaultOffice, programLocation], '2026-05-07');

  assert.equal(resolved?.id, 'program-location');
});

test('inactive and archived locations are ignored when resolving attendance location', () => {
  const resolved = resolveOfficeLocationForDate([
    defaultOffice,
    { ...programLocation, archivedAt: new Date('2026-05-03T08:00:00.000Z'), id: 'archived-program' },
    { ...programLocation, id: 'inactive-program', isActive: false },
  ], '2026-05-07');

  assert.equal(resolved?.id, 'default-office');
});

test('scheduled location date overlap is rejected', () => {
  const schedules = [
    { ...programLocation, id: 'program-a' },
    {
      id: 'program-b',
      isActive: true,
      locationKind: 'scheduled',
      scheduleEndDate: '2026-05-12',
      scheduleStartDate: '2026-05-10',
    },
  ];

  assert.equal(overlapsOfficeLocationSchedule(schedules, {
    endDate: '2026-05-09',
    startDate: '2026-05-08',
  }), true);
  assert.equal(overlapsOfficeLocationSchedule(schedules, {
    endDate: '2026-05-09',
    startDate: '2026-05-09',
  }), false);
});

