/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function loadMonitor() {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (request === '@/db') return { db: {} };
    if (request === '@/lib/attendance') return { getAccraClock: () => ({}), getHolidayForDate: async () => null, isWeekendDate: () => false };
    if (request === '@/lib/reminder-fallback') return { isCronReminderRun: (source) => source !== 'app', REMINDER_GRACE_MINUTES: 5 };
    if (request === '@/lib/staff-leave-service') return { getStaffLeavePeriodsForRange: async () => [] };
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, 'src/lib/reminder-delivery-monitor.ts'));
  } finally {
    Module._load = originalLoad;
  }
}

const { decideReminderRow } = loadMonitor();
const noDeliveries = { delivered: 0, disabled: 0, failed: 0, latestDeliveredAt: null, latestError: null, latestSentAt: null, pending: 0, sent: 0 };
const base = {
  attendance: null,
  counts: noDeliveries,
  enabledSubscriptions: 1,
  hadDisabledSubscriptions: false,
  hasCurrentFailure: false,
  hasTrustedDevice: true,
  isHoliday: false,
  isWeekend: false,
  missedAfter: true,
  onLeave: false,
  reminderType: 'sign_in',
  subscriptions: 1,
  turnedOnAfterRun: false,
};

test('a reminder is only "missing" once the grace period has passed', () => {
  assert.equal(decideReminderRow({ ...base, missedAfter: false }).status, 'waiting');
  assert.equal(decideReminderRow(base).status, 'missing');
});

test('turning reminders on after the run is not a missing reminder', () => {
  const row = decideReminderRow({ ...base, turnedOnAfterRun: true });
  assert.equal(row.status, 'skipped');
  assert.equal(row.reason, "Turned on after today's reminder");
});

test('staff on leave are skipped, and an expired phone counts as failed', () => {
  assert.deepEqual(decideReminderRow({ ...base, onLeave: true }), { eligible: false, reason: 'On leave', status: 'skipped' });
  const expired = decideReminderRow({ ...base, counts: { ...noDeliveries, disabled: 1 }, enabledSubscriptions: 0, subscriptions: 0 });
  assert.equal(expired.status, 'failed');
});

test('a phone switched off by a reset reads "turn on again", not "never registered"', () => {
  const row = decideReminderRow({ ...base, enabledSubscriptions: 0, hadDisabledSubscriptions: true, subscriptions: 0 });
  assert.equal(row.status, 'notifications_not_registered');
  assert.equal(row.reason, 'Reminders need turning on again');
});

test('the sender skips staff on leave', () => {
  const source = read('src', 'lib', 'push-reminders.ts');
  assert.match(source, /if \(input\.isWeekend \|\| input\.isHoliday \|\| input\.onLeave\) return false;/);
  assert.match(source, /onLeave: onLeaveStaffIds\.has\(row\.staffId\)/);
});

test('a transfer is claimed before anything changes, released if approval fails, and closes sibling requests', () => {
  const route = read('src', 'app', 'api', 'attendance', 'device-transfers', '[id]', 'route.ts');
  assert.match(route, /\.where\(and\(eq\(deviceTransferRequest\.id, transfer\.id\), eq\(deviceTransferRequest\.status, 'pending'\)\)\)/);
  assert.ok(route.indexOf("eq(deviceTransferRequest.status, 'pending'))") < route.indexOf('findSharedAttendanceDeviceOwner({'));
  assert.equal((route.match(/await releaseClaim\(transfer\.id\);/g) || []).length, 3);
  assert.match(route, /ne\(deviceTransferRequest\.id, transfer\.id\)/);
  assert.match(route, /if \(claimedId\) await releaseClaim\(claimedId\)/);
});

test('device health: alerts are recent shared-device blocks, leave is not chased, errors are JSON', () => {
  const health = read('src', 'lib', 'device-session-health.ts');
  const route = read('src', 'app', 'api', 'attendance', 'device-health', 'route.ts');
  const page = read('src', 'app', 'attendance', 'devices', 'page.tsx');
  assert.match(health, /SECURITY_ALERT_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(health, /asRecord\(event\.afterJson\)\?\.result === SHARED_ATTENDANCE_DEVICE_RESULT/);
  assert.match(health, /if \(!onLeave\) \{/);
  assert.match(route, /Could not load device health/);
  // Page: newest load wins, refreshes are debounced, failures don't look like "all fine".
  assert.match(page, /if \(signal\?\.aborted \|\| loadId < appliedLoadRef\.current\) return;/);
  assert.match(page, /REALTIME_REFRESH_DELAY_MS/);
  assert.match(page, /Could not load today&apos;s reminder status/);
  assert.match(page, /\{row\.trustedDevice\.registered \? \(/);
  assert.match(page, /\{resetError && \(/);
});

test('the notifications feed (built from the audit trail) is for admins only', () => {
  const route = read('src', 'app', 'api', 'notifications', 'route.ts');
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(get, /if \(await enforceRole\(\['admin'\]\)\) \{\s*return NextResponse\.json\(\{ notifications: \[\], unreadCount: 0 \}/);
});
