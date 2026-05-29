/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { computePenalty } = require('../src/lib/penalty-calculator.ts');
const { getAuditFieldChanges, getAuditTargetName } = require('../src/lib/audit-display.ts');
const { DEFAULT_OFFICE_RADIUS_METERS, validateAttendanceLocation } = require('../src/lib/geo-location.ts');
const { getClientIp, getClientIpInfo, isLoopbackIp } = require('../src/lib/request-ip.ts');
const {
  isOnTimeCheckIn,
  isAfterWorkdayEnd,
  NO_SIGN_OUT_ALERT_LABEL,
  NO_SIGN_OUT_ALERT_TIME,
  shouldAlertNoSignOut,
} = require('../src/lib/work-hours.ts');
const {
  ABSENCE_PERMISSION_REASONS,
  formatAbsencePermissionReason,
  formatLateArrivalPermissionReason,
  getAbsencePeriodBounds,
  getInclusivePermissionDateRange,
  isGeneralPardonReason,
  isValidAbsencePermissionReason,
  isValidLateArrivalPermissionReason,
} = require('../src/lib/attendance-permissions.ts');

function requestWithHeaders(headers) {
  return {
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
  };
}

test('attendance rules use 8:30 AM as the lateness cutoff and close after 5:00 PM', () => {
  assert.deepEqual(
    computePenalty({ arrivalTime: '08:30', didNotSignOut: false, isHoliday: false }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: '08:31', didNotSignOut: false, isHoliday: false }),
    { amount: 10, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.equal(isAfterWorkdayEnd('17:00:00'), false);
  assert.equal(isAfterWorkdayEnd('17:01:00'), true);
});

test('regular staff penalties increase at one minute past each clock hour', () => {
  const cases = [
    ['08:30', 0],
    ['08:31', 10],
    ['09:00', 10],
    ['09:01', 15],
    ['10:00', 15],
    ['10:01', 20],
  ];

  for (const [arrivalTime, amount] of cases) {
    assert.equal(
      computePenalty({ arrivalTime, didNotSignOut: false, isHoliday: false }).amount,
      amount,
      `${arrivalTime} should be GHC ${amount}`,
    );
  }
});

test('on-time attendance is based on actual check-in time', () => {
  assert.equal(isOnTimeCheckIn('08:29'), true);
  assert.equal(isOnTimeCheckIn('08:30'), true);
  assert.equal(isOnTimeCheckIn('08:31'), false);
  assert.equal(isOnTimeCheckIn('09:00'), false);
  assert.equal(isOnTimeCheckIn(null), false);
});

test('no sign-out alert starts at 8:00 PM', () => {
  assert.equal(NO_SIGN_OUT_ALERT_TIME, '20:00');
  assert.equal(NO_SIGN_OUT_ALERT_LABEL, '8:00 PM');
  assert.equal(shouldAlertNoSignOut('19:59:59'), false);
  assert.equal(shouldAlertNoSignOut('20:00:00'), true);
});

test('NSS personnel late penalty stays flat while regular staff use the clock-hour rule', () => {
  assert.deepEqual(
    computePenalty({ arrivalTime: '10:01', didNotSignOut: false, isHoliday: false }),
    { amount: 20, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: '10:31', didNotSignOut: false, isHoliday: false, isNssPersonnel: true }),
    { amount: 10, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: '10:31', didNotSignOut: true, isHoliday: false, isNssPersonnel: true }),
    { amount: 12, reason: 'DIDN\'T COME BEFORE 8:30AM AND DID NOT SIGN OUT' },
  );
});

test('attendance monitoring only staff are never charged penalties', () => {
  assert.deepEqual(
    computePenalty({ arrivalTime: '10:31', didNotSignOut: false, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: '10:31', didNotSignOut: true, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: null, didNotSignOut: true, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
});

test('excused absence permission reasons are restricted to the approved list', () => {
  assert.deepEqual(
    ABSENCE_PERMISSION_REASONS.map((option) => option.value),
    ['training', 'official duty', 'personal excuse', 'sick', 'workshop', 'general pardon'],
  );
  assert.equal(isValidAbsencePermissionReason('training'), true);
  assert.equal(isValidAbsencePermissionReason(' official duty '), true);
  assert.equal(isValidAbsencePermissionReason('Workshop'), true);
  assert.equal(isValidAbsencePermissionReason('Field Work'), false);
  assert.equal(isValidAbsencePermissionReason('General pardon'), true);
  assert.equal(isValidAbsencePermissionReason('Sick'), true);
  assert.equal(isValidAbsencePermissionReason('personal excuse'), true);
  assert.equal(isValidAbsencePermissionReason('meeting'), false);
  assert.equal(formatAbsencePermissionReason('personal excuse'), 'Personal excuse');
  assert.equal(formatAbsencePermissionReason('sick'), 'Sick');
  assert.equal(formatAbsencePermissionReason('workshop'), 'Workshop');
  assert.equal(formatAbsencePermissionReason('field work'), 'Official duty');
  assert.equal(formatAbsencePermissionReason('general pardon'), 'General pardon');
  assert.equal(formatAbsencePermissionReason('custom existing reason'), 'custom existing reason');
});

test('late arrival permission reasons use the same approved list', () => {
  assert.equal(isValidLateArrivalPermissionReason('workshop'), true);
  assert.equal(isValidLateArrivalPermissionReason('Field Work'), false);
  assert.equal(isValidLateArrivalPermissionReason('Official duty'), true);
  assert.equal(isValidLateArrivalPermissionReason('General pardon'), true);
  assert.equal(isValidLateArrivalPermissionReason('Sick'), true);
  assert.equal(isValidLateArrivalPermissionReason('personal excuse'), true);
  assert.equal(isValidLateArrivalPermissionReason('custom reason'), false);
  assert.equal(formatLateArrivalPermissionReason('training'), 'Training');
  assert.equal(formatLateArrivalPermissionReason('personal excuse'), 'Personal excuse');
  assert.equal(formatLateArrivalPermissionReason('sick'), 'Sick');
  assert.equal(formatLateArrivalPermissionReason('field work'), 'Official duty');
  assert.equal(formatLateArrivalPermissionReason('general pardon'), 'General pardon');
  assert.equal(isGeneralPardonReason(' General pardon '), true);
  assert.equal(isGeneralPardonReason('training'), false);
});

test('excused absence permissions use date ranges and full-day bounds', () => {
  assert.deepEqual(
    getInclusivePermissionDateRange('2026-05-04', '2026-05-08'),
    ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08'],
  );
  assert.deepEqual(
    getAbsencePeriodBounds({
      permissionType: 'absence',
    }),
    {
      endTime: null,
      label: 'Full day',
      startTime: null,
    },
  );
});

test('office network audit display includes the saved network IP', () => {
  const record = {
    afterJson: { allowedIp: '192.0.2.15', name: 'Office WiFi' },
    beforeJson: { allowedIp: '192.0.2.10', name: 'Office WiFi' },
    entityId: 'network-1',
    entityType: 'office_network',
  };

  assert.equal(getAuditTargetName(record), 'Office WiFi (192.0.2.15)');

  const changes = getAuditFieldChanges(record);
  assert.deepEqual(changes, [{
    after: '192.0.2.15',
    before: '192.0.2.10',
    field: 'allowedIp',
    label: 'Office IP',
  }]);
});

test('client IP detection prefers Vercel forwarded IP and normalizes IPv6 wrappers', () => {
  assert.equal(
    getClientIp(requestWithHeaders({
      'x-forwarded-for': '198.51.100.20, 10.0.0.1',
      'x-vercel-forwarded-for': '203.0.113.10, 10.0.0.1',
    })),
    '203.0.113.10',
  );
  assert.equal(getClientIp(requestWithHeaders({ 'x-vercel-forwarded-for': '[2001:db8::1]' })), '2001:db8::1');
  assert.equal(getClientIp(requestWithHeaders({ 'x-vercel-forwarded-for': '198.51.100.25:443' })), '198.51.100.25');
  assert.deepEqual(
    getClientIpInfo(requestWithHeaders({
      'x-forwarded-for': 'unknown, 198.51.100.20',
      'x-vercel-forwarded-for': 'bad-value',
    })),
    { ip: '198.51.100.20', isPublic: true, source: 'x-forwarded-for' },
  );
  assert.equal(isLoopbackIp('::1'), true);
  assert.equal(isLoopbackIp('203.0.113.10'), false);
});

test('attendance geofence validates fresh accurate office location', () => {
  const office = {
    latitude: 5.6037168,
    longitude: -0.1869644,
    maxAccuracyMeters: 75,
    radiusMeters: 100,
  };
  const now = new Date('2026-05-05T08:45:00.000Z');

  const inside = validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.60375,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  });

  assert.equal(inside.ok, true);
  assert.equal(inside.result, 'LOCATION_VERIFIED');
  assert.ok(inside.distanceMeters < 10);

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 150,
      latitude: 5.60375,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  }).result, 'LOCATION_ACCURACY_WEAK');

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.606,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  }).result, 'OUTSIDE_OFFICE_LOCATION');

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 150,
      latitude: 5.606,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  }).result, 'OUTSIDE_OFFICE_LOCATION');

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.60375,
      longitude: -0.18695,
      mocked: true,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  }).result, 'LOCATION_MOCKED');

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.60375,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:42:00.000Z',
    },
    now,
    office,
  }).result, 'LOCATION_STALE');
});

test('default office geofence uses an 80m radius with the existing 75m accuracy limit', () => {
  assert.equal(DEFAULT_OFFICE_RADIUS_METERS, 80);

  const office = {
    latitude: 5.6037168,
    longitude: -0.1869644,
    maxAccuracyMeters: 75,
  };
  const now = new Date('2026-05-05T08:45:00.000Z');

  const inside = validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.6044268,
      longitude: -0.1869644,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  });

  assert.equal(inside.ok, true);
  assert.equal(inside.result, 'LOCATION_VERIFIED');
  assert.ok(inside.distanceMeters <= 80);

  const outside = validateAttendanceLocation({
    evidence: {
      accuracy: 20,
      latitude: 5.6044568,
      longitude: -0.1869644,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  });

  assert.equal(outside.ok, false);
  assert.equal(outside.result, 'OUTSIDE_OFFICE_LOCATION');

  assert.equal(validateAttendanceLocation({
    evidence: {
      accuracy: 76,
      latitude: 5.60375,
      longitude: -0.18695,
      timestamp: '2026-05-05T08:44:45.000Z',
    },
    now,
    office,
  }).result, 'LOCATION_ACCURACY_WEAK');
});
