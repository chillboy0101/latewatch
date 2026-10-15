/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function loadWithMocks(file, mocks) {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, file));
  } finally {
    Module._load = originalLoad;
  }
}

test('only verified addresses identify a staff member, primary first', async () => {
  const looked = [];
  const { findStaffForEmails, verifiedEmailAddresses } = loadWithMocks('src/lib/auth/signed-in-staff.ts', {
    '@/lib/attendance': {
      getStaffByEmail: async (email) => {
        looked.push(email);
        return email === 'kwame.asante@office.com' ? { id: 'kwame' } : null;
      },
    },
  });
  const user = {
    emailAddresses: [
      { emailAddress: 'kwame_asante@office.com', id: 'a', verification: { status: 'unverified' } },
      { emailAddress: 'Me@Personal.com ', id: 'b', verification: { status: 'verified' } },
      { emailAddress: 'kwame.asante@office.com', id: 'c', verification: null },
      { emailAddress: 'me@office.com', id: 'd', verification: { status: 'verified' } },
    ],
    primaryEmailAddressId: 'd',
  };
  assert.deepEqual(verifiedEmailAddresses(user), ['me@office.com', 'me@personal.com']);
  assert.equal(await findStaffForEmails(verifiedEmailAddresses(user)), null);
  assert.deepEqual(looked, ['me@office.com', 'me@personal.com']);
});

test('staff are matched on the exact address, never by wildcard or name', () => {
  const attendance = read('src', 'lib', 'attendance.ts');
  assert.match(attendance, /eq\(sql`lower\(\$\{staff\.email\}\)`, normalizedEmail\)/);
  assert.doesNotMatch(attendance, /ilike\(/);
  assert.doesNotMatch(attendance, /getOrAutoLinkStaffByEmail/);
  for (const parts of [
    ['src', 'app', 'api', 'attendance', 'check-in', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'penalty-history', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'receipts', '[paymentId]', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'receipt-notifications', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'push-subscription', 'route.ts'],
    ['src', 'app', 'api', 'attendance', 'check-in', 'push-subscription', 'test', 'route.ts'],
  ]) {
    const source = read(...parts);
    assert.doesNotMatch(source, /user\.emailAddresses\.map/, parts.join('/'));
    assert.doesNotMatch(source, /getOrAutoLinkStaffByEmail|attendance-auto-link/, parts.join('/'));
  }
  assert.doesNotMatch(read('src', 'app', 'api', 'staff', 'route.ts'), /ilike\(/);
  assert.doesNotMatch(read('src', 'app', 'api', 'staff', '[id]', 'route.ts'), /ilike\(/);
});

test('realtime tokens can only listen; staff only on their own channels', () => {
  const route = read('src', 'app', 'api', 'realtime', 'token', 'route.ts');
  assert.match(route, /\{ 'latewatch:\*': \['subscribe'\] \}/);
  assert.match(route, /const STAFF_CHANNELS = \['attendance', 'notifications', 'staff-penalty-history'\];/);
  assert.match(route, /themeChannelForUser\(user\.id\)/);
  assert.doesNotMatch(route, /'publish'/);
});

test('staff can only mark their own payment receipts; ids are capped', () => {
  const route = read('src', 'app', 'api', 'notifications', 'route.ts');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.match(post, /const ids = isAdmin \? requestedIds : await ownReceiptNotificationIds\(requestedIds\);/);
  assert.match(route, /\.where\(and\(inArray\(latenessPayment\.id, paymentIds\), eq\(latenessPayment\.staffId, member\.id\)\)\);/);
  assert.match(route, /id\.length <= MAX_NOTIFICATION_ID_LENGTH/);
  // The check-in page dismisses receipts through this endpoint, so it must keep working for staff.
  assert.match(read('src', 'app', 'check-in', 'page.tsx'), /body: JSON\.stringify\(\{ action: 'dismiss', ids: \[id\] \}\)/);
});

test('reminders are only posted to real push services', () => {
  const { isKnownPushEndpoint } = loadWithMocks('src/lib/push-reminders.ts', {
    '@/db': { db: {} },
    '@/lib/attendance': { getAccraClock: () => ({}), getHolidayForDate: async () => null, isWeekendDate: () => false },
    '@/lib/realtime': { publishRealtime: () => null },
    '@/lib/staff-leave-service': { getStaffLeavePeriodsForRange: async () => [] },
  });
  assert.equal(isKnownPushEndpoint('https://web.push.apple.com/QF4abc'), true);
  assert.equal(isKnownPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(isKnownPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), true);
  assert.equal(isKnownPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), true);
  assert.equal(isKnownPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isKnownPushEndpoint('https://evil.example.com/fcm.googleapis.com'), false);
  assert.equal(isKnownPushEndpoint('https://fcm.googleapis.com.evil.com/x'), false);
  assert.equal(isKnownPushEndpoint('not a url'), false);
  assert.match(read('src', 'app', 'api', 'attendance', 'check-in', 'push-subscription', 'route.ts'), /!isKnownPushEndpoint\(endpoint\)/);
});

test('a failed reminder is retried for an hour, claimed by one run only, with the error code kept', () => {
  const source = read('src', 'lib', 'push-reminders.ts');
  assert.match(source, /const FAILED_DELIVERY_RETRY_MS = 60 \* 60 \* 1000;/);
  assert.match(source, /if \(existingDelivery\.status !== 'pending' && !isRetryableFailedDelivery\(existingDelivery\)\) \{\s*return null;/);
  assert.match(source, /: eq\(pushReminderDelivery\.status, 'failed'\),/);
  assert.match(source, /lt\(pushReminderDelivery\.createdAt, new Date\(Date\.now\(\) - STALE_PENDING_DELIVERY_MS\)\)/);
  assert.match(source, /error: pushErrorText\(error\),/);
});

test('a failed live update is caught, so it can never end a request early', () => {
  const source = read('src', 'lib', 'realtime.ts');
  assert.match(source, /void ablyPublish\(`latewatch:\$\{channel\}`, event, data\)\.catch\(\(error\) => \{\s*console\.warn\('Realtime publish failed:', error\);/);
});
