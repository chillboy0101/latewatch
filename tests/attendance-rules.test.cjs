/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  computePenalty,
  DAILY_PENALTY_CAP,
  NO_SHOW_SIGN_IN_AMOUNT,
  NO_SHOW_SIGN_IN_REASON,
} = require('../src/lib/penalty-calculator.ts');
const { getAuditFieldChanges, getAuditTargetName } = require('../src/lib/audit-display.ts');
const { DEFAULT_OFFICE_RADIUS_METERS, validateAttendanceLocation } = require('../src/lib/geo-location.ts');
const { getClientIp, getClientIpInfo, isLoopbackIp } = require('../src/lib/request-ip.ts');
const {
  isOnTimeCheckIn,
  isSignInClosed,
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
  isPermissionWindowActive,
  isPermissionWindowOverdue,
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

test('attendance rules use 8:30 AM as the lateness cutoff and close sign-in at 4:30 PM', () => {
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '08:30', didNotSignOut: false, isHoliday: false }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '08:31', didNotSignOut: false, isHoliday: false }),
    { amount: 10, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  // Sign-in closes when the GHC 10 no sign-in fee applies, so a 4:40 sign-in can't turn it into GHC 50.
  assert.equal(isSignInClosed('16:29:59'), false);
  assert.equal(isSignInClosed('16:30:00'), true);
  assert.equal(isSignInClosed('17:01:00'), true);
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
      computePenalty({ date: '2026-10-09', arrivalTime, didNotSignOut: false, isHoliday: false }).amount,
      amount,
      `${arrivalTime} should be GHC ${amount}`,
    );
  }
});

test('sign-in closes at 4:30: arriving at or after it is charged as no sign-in (GHC 10), never the late fee', () => {
  for (const arrivalTime of ['16:30', '16:37', '17:01', '20:00']) {
    const main = computePenalty({ date: '2026-10-09', arrivalTime, didNotSignOut: true, isHoliday: false });
    assert.equal(main.amount, NO_SHOW_SIGN_IN_AMOUNT, `${arrivalTime} main staff`);
    assert.equal(main.reason, 'SIGNED IN AFTER 4:30PM');
    assert.equal(computePenalty({ date: '2026-10-09', arrivalTime, didNotSignOut: false, isHoliday: false, isNssPersonnel: true }).amount, 10, `${arrivalTime} NSS`);
    assert.equal(computePenalty({ date: '2026-10-09', arrivalTime, didNotSignOut: false, isAttendanceOnly: true, isHoliday: false }).amount, 0, `${arrivalTime} attendance-only`);
  }
  assert.equal(computePenalty({ date: '2026-10-09', arrivalTime: '16:29', didNotSignOut: false, isHoliday: false }).amount, 50, 'one minute earlier is still a (capped) late arrival');
});

test('late-arrival penalty is capped at the GHC 50 daily ceiling', () => {
  assert.equal(DAILY_PENALTY_CAP, 50);

  const cases = [
    ['16:01', 50],
    ['16:29', 50],
  ];

  for (const [arrivalTime, amount] of cases) {
    assert.equal(
      computePenalty({ date: '2026-10-09', arrivalTime, didNotSignOut: false, isHoliday: false }).amount,
      amount,
      `${arrivalTime} should be capped at GHC ${amount}`,
    );
  }

  assert.equal(
    computePenalty({ date: '2026-10-09', arrivalTime: '16:29', didNotSignOut: true, isHoliday: false }).amount,
    50,
    'GHC 50 is a hard ceiling for the day -- the no-signout penalty does not push a capped late arrival above it',
  );

  assert.equal(
    computePenalty({ date: '2026-10-09', arrivalTime: '14:01', didNotSignOut: true, isHoliday: false }).amount,
    42,
    'the GHC 2 no-signout penalty still stacks normally below the cap',
  );

  assert.equal(
    computePenalty({ date: '2026-10-09', arrivalTime: '16:29', didNotSignOut: false, isHoliday: false, isNssPersonnel: true }).amount,
    10,
    'NSS personnel are unaffected by the cap since their hourly increment is always 0',
  );

  assert.equal(
    computePenalty({ date: '2026-10-09', arrivalTime: '16:29', didNotSignOut: true, isHoliday: false, isNssPersonnel: true }).amount,
    12,
    'NSS personnel late plus no-signout stays well under the cap',
  );
});

test('on-time attendance is based on actual check-in time', () => {
  assert.equal(isOnTimeCheckIn('08:29'), true);
  assert.equal(isOnTimeCheckIn('08:30'), true);
  assert.equal(isOnTimeCheckIn('08:31'), false);
  assert.equal(isOnTimeCheckIn('09:00'), false);
  assert.equal(isOnTimeCheckIn(null), false);
});

test('date-wide late-arrival pardons override individual windows and never become overdue', () => {
  const permission = {
    arrivalWindow: 'morning',
    expectedEndTime: '12:00',
    expectedStartTime: '08:30',
    generalPardonType: 'late_arrival',
    permissionType: 'late_arrival',
  };

  assert.equal(isPermissionWindowActive(permission, '14:10'), true);
  assert.equal(isPermissionWindowActive(permission, '23:59'), true);
  assert.equal(isPermissionWindowOverdue(permission, '2026-05-06', '2026-05-06', '14:10'), false);
});

test('no sign-out alert starts at 8:00 PM', () => {
  assert.equal(NO_SIGN_OUT_ALERT_TIME, '20:00');
  assert.equal(NO_SIGN_OUT_ALERT_LABEL, '8:00 PM');
  assert.equal(shouldAlertNoSignOut('19:59:59'), false);
  assert.equal(shouldAlertNoSignOut('20:00:00'), true);
});

test('NSS personnel late penalty stays flat while regular staff use the clock-hour rule', () => {
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '10:01', didNotSignOut: false, isHoliday: false }),
    { amount: 20, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '10:31', didNotSignOut: false, isHoliday: false, isNssPersonnel: true }),
    { amount: 10, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '10:31', didNotSignOut: true, isHoliday: false, isNssPersonnel: true }),
    { amount: 12, reason: 'DIDN\'T COME BEFORE 8:30AM AND DID NOT SIGN OUT' },
  );
});

test('attendance monitoring only staff are never charged penalties', () => {
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '10:31', didNotSignOut: false, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '10:31', didNotSignOut: true, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: true, isHoliday: false, isAttendanceOnly: true }),
    { amount: 0, reason: '' },
  );
});

test('no-show sign-in penalty is a flat GHC 10 and overrides no-sign-out', () => {
  assert.equal(NO_SHOW_SIGN_IN_AMOUNT, 10);
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: false, isHoliday: false, noSignIn: true }),
    { amount: NO_SHOW_SIGN_IN_AMOUNT, reason: NO_SHOW_SIGN_IN_REASON },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: true, isHoliday: false, noSignIn: true }),
    { amount: NO_SHOW_SIGN_IN_AMOUNT, reason: NO_SHOW_SIGN_IN_REASON },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: true, isHoliday: false, isNssPersonnel: true, noSignIn: true }),
    { amount: NO_SHOW_SIGN_IN_AMOUNT, reason: NO_SHOW_SIGN_IN_REASON },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: true, isHoliday: true, noSignIn: true }),
    { amount: 0, reason: 'HOLIDAY' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: null, didNotSignOut: true, isHoliday: false, isAttendanceOnly: true, noSignIn: true }),
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
    getInclusivePermissionDateRange('2026-10-01', '2026-10-06'),
    ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'],
  );
  assert.deepEqual(getInclusivePermissionDateRange('2026-10-03', '2026-10-04'), []);
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

test('permissions and general pardons are refused on weekends and holidays', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const permissionsRoute = read('src', 'app', 'api', 'attendance', 'permissions', 'route.ts');
  const pardonRoute = read('src', 'app', 'api', 'attendance', 'permissions', 'general-pardon', 'route.ts');
  const overview = read('src', 'app', 'attendance', 'overview', 'page.tsx');

  assert.match(permissionsRoute, /appliedDates\.map\(\(permissionDate\) => getNonWorkdayLabel\(permissionDate\)\)/);
  assert.match(permissionsRoute, /so no permission is needed/);
  assert.match(permissionsRoute, /The selected period has no workdays/);
  assert.match(pardonRoute, /getNonWorkdayLabel\(date\)/);
  assert.match(overview, /disabled=\{savingGeneralPardon \|\| !data\?\.rows\.length \|\| isWeekendAttendanceDate\}/);
});

test('the GHC 2 no-sign-out charge stops from 12 Oct 2026; earlier days keep it', () => {
  const { chargesNoSignOut, isNoSignOutChargeDue } = require('../src/lib/work-hours.ts');
  assert.equal(chargesNoSignOut('2026-10-09'), true);
  assert.equal(chargesNoSignOut('2026-10-12'), false);
  assert.equal(isNoSignOutChargeDue('2026-10-12', '2026-10-23', '09:00'), false);
  assert.equal(isNoSignOutChargeDue('2026-10-09', '2026-10-23', '09:00'), true);

  assert.deepEqual(
    computePenalty({ date: '2026-10-09', arrivalTime: '08:00', didNotSignOut: true, isHoliday: false }),
    { amount: 2, reason: 'DID NOT SIGN OUT' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-12', arrivalTime: '08:00', didNotSignOut: true, isHoliday: false }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ date: '2026-10-21', arrivalTime: '10:24', didNotSignOut: true, isHoliday: false }),
    computePenalty({ date: '2026-10-21', arrivalTime: '10:24', didNotSignOut: false, isHoliday: false }),
    'late + no sign-out is just the late charge',
  );
});

test('manual and synced penalties drop the no-sign-out from 12 Oct 2026', () => {
  const { resolveManualPenalty } = require('../src/lib/manual-attendance-correction.ts');
  const before = resolveManualPenalty({ arrivalTime: '08:00', date: '2026-10-09', didNotSignOut: true });
  assert.equal(before.amount, 2);
  assert.equal(before.didNotSignOut, true);
  const after = resolveManualPenalty({ arrivalTime: '08:00', date: '2026-10-16', didNotSignOut: true });
  assert.equal(after.amount, 0);
  assert.equal(after.didNotSignOut, false, 'no GHC 0 entry is kept for it');
  const latePermitted = resolveManualPenalty({
    activePermission: { arrivalWindow: 'any_time_today', permissionType: 'late_arrival', reason: 'official duty', status: 'approved' },
    arrivalTime: '10:39',
    date: '2026-10-19',
    didNotSignOut: true,
  });
  assert.equal(latePermitted.amount, 0);
});

test('a missing or malformed date keeps the no-sign-out charge (fails closed)', () => {
  const { chargesNoSignOut } = require('../src/lib/work-hours.ts');
  assert.equal(chargesNoSignOut(undefined), true);
  assert.equal(chargesNoSignOut(''), true);
  assert.equal(chargesNoSignOut('20261013'), true);
  assert.equal(computePenalty({ arrivalTime: '08:00', didNotSignOut: true, isHoliday: false }).amount, 2);
});

test('scripts and the Entries page pass the day to the no-sign-out rule', () => {
  const fs = require('node:fs');
  const script = fs.readFileSync(require('node:path').join(__dirname, '../scripts/repair-2026-07-09-pardons.mjs'), 'utf8');
  assert.equal((script.match(/computePenalty\(\{[^}]*date: INCIDENT_DATE/g) || []).length, 2);
  const page = fs.readFileSync(require('node:path').join(__dirname, '../src/app/entries/page.tsx'), 'utf8');
  assert.match(page, /\|\| !chargesNoSignOut\(format\(selectedDate, 'yyyy-MM-dd'\)\)/);
});
