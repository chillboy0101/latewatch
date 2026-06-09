/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const schemaPath = path.join(root, 'src/db/schema.ts');
const migrationPath = path.join(root, 'drizzle/0025_push_reminders.sql');
const seedMigrationPath = path.join(root, 'src/app/api/seed/migrate/route.ts');
const checkInPagePath = path.join(root, 'src/app/check-in/page.tsx');
const attendancePagePath = path.join(root, 'src/app/attendance/page.tsx');
const pushApiPath = path.join(root, 'src/app/api/attendance/check-in/push-subscription/route.ts');
const pushTestApiPath = path.join(root, 'src/app/api/attendance/check-in/push-subscription/test/route.ts');
const morningReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/morning/route.ts');
const signInReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-in/route.ts');
const signOutReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-out/route.ts');
const holidayReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/holiday/route.ts');
const proxyPath = path.join(root, 'src/proxy.ts');
const pushClientLibPath = path.join(root, 'src/lib/push-client.ts');
const pushReminderToggleConfirmationLibPath = path.join(root, 'src/lib/push-reminder-toggle-confirmation.ts');
const pushReminderLibPath = path.join(root, 'src/lib/push-reminders.ts');
const reminderCronGuardPath = path.join(root, 'src/lib/reminder-cron-guard.ts');
const attendanceLibPath = path.join(root, 'src/lib/attendance.ts');
const serviceWorkerPath = path.join(root, 'public/sw.js');
const vercelPath = path.join(root, 'vercel.json');

test('push reminder package, schema, migration, and seed repair are defined', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seedMigration = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.ok(pkg.dependencies?.['web-push']);
  assert.equal(fs.existsSync(migrationPath), true);
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(schema, /export const pushSubscription = pgTable\('push_subscription'/);
  assert.match(schema, /signInEnabled: boolean\('sign_in_enabled'\)\.default\(true\)\.notNull\(\)/);
  assert.match(schema, /signOutEnabled: boolean\('sign_out_enabled'\)\.default\(true\)\.notNull\(\)/);
  assert.match(schema, /export const pushReminderDelivery = pgTable\('push_reminder_delivery'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_subscription/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_reminder_delivery/);
  assert.match(seedMigration, /CREATE TABLE IF NOT EXISTS push_subscription/);
  assert.match(seedMigration, /CREATE TABLE IF NOT EXISTS push_reminder_delivery/);
});

test('check-in page replaces auto attendance controls with reminder notification controls', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  const attendancePage = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /ReminderNotificationPanel/);
  assert.match(source, /Enable sign-in reminder/);
  assert.match(source, /Enable sign-out reminder/);
  assert.match(source, /\/api\/attendance\/check-in\/push-subscription/);
  assert.doesNotMatch(source, /\/api\/attendance\/check-in\/push-subscription\/test/);
  assert.doesNotMatch(source, /Send test reminder/);
  assert.match(source, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(source, /navigator\.serviceWorker\.ready/);
  assert.doesNotMatch(source, /Reminder notifications are not configured/);
  assert.doesNotMatch(source, /Attendance reminders/);
  assert.doesNotMatch(source, /Phone reminders run on Ghana workdays/);
  assert.doesNotMatch(source, /Ask an admin to finish setup/);
  assert.match(source, /getPushReminderPublicKey/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| !configured \|\| notificationPermission === 'unsupported'\}/);
  assert.match(source, /disabled=\{disabled \|\| notificationPermission === 'unsupported'\}/);
  assert.doesNotMatch(source, /AutoAttendancePanel/);
  assert.doesNotMatch(source, /Auto check-in/);
  assert.doesNotMatch(source, /Auto sign-out/);
  assert.doesNotMatch(source, /\/api\/attendance\/check-in\/auto-settings/);
  assert.doesNotMatch(source, /source: 'auto_attendance'/);
  assert.doesNotMatch(attendancePage, /Auto in|Auto out/);
});

test('push subscription API and reminder cron routes are wired', () => {
  assert.equal(fs.existsSync(pushApiPath), true);
  assert.equal(fs.existsSync(pushTestApiPath), true);
  assert.equal(fs.existsSync(morningReminderRoutePath), true);
  assert.equal(fs.existsSync(signInReminderRoutePath), true);
  assert.equal(fs.existsSync(signOutReminderRoutePath), true);
  assert.equal(fs.existsSync(holidayReminderRoutePath), true);
  assert.equal(fs.existsSync(reminderCronGuardPath), true);

  const pushApi = fs.readFileSync(pushApiPath, 'utf8');
  const pushTestApi = fs.readFileSync(pushTestApiPath, 'utf8');
  const pushReminderLib = fs.readFileSync(pushReminderLibPath, 'utf8');
  const morningRoute = fs.readFileSync(morningReminderRoutePath, 'utf8');
  const signInRoute = fs.readFileSync(signInReminderRoutePath, 'utf8');
  const signOutRoute = fs.readFileSync(signOutReminderRoutePath, 'utf8');
  const holidayRoute = fs.readFileSync(holidayReminderRoutePath, 'utf8');
  const cronGuard = fs.readFileSync(reminderCronGuardPath, 'utf8');
  const proxy = fs.readFileSync(proxyPath, 'utf8');
  const vercel = fs.readFileSync(vercelPath, 'utf8');
  const vercelConfig = JSON.parse(vercel);

  assert.match(pushApi, /export async function GET/);
  assert.doesNotMatch(pushApi, /export async function POST/);
  assert.match(pushApi, /export async function PUT/);
  assert.match(pushApi, /export async function DELETE/);
  assert.match(pushApi, /pushSubscription/);
  assert.match(pushApi, /getVapidPublicKey/);
  assert.doesNotMatch(pushApi, /LateWatch test notification/);
  assert.doesNotMatch(pushApi, /System notifications are working on this device\./);
  assert.doesNotMatch(pushApi, /latewatch-test-notification/);
  assert.match(pushTestApi, /currentUser/);
  assert.match(pushTestApi, /getOrAutoLinkStaffByEmail/);
  assert.match(pushTestApi, /export async function POST/);
  assert.match(pushTestApi, /webpush\.sendNotification/);
  assert.match(pushTestApi, /latewatch-reminder-test/);
  assert.match(pushTestApi, /eq\(pushSubscription\.staffId, resolved\.staffMember\.id\)/);
  assert.match(pushTestApi, /eq\(pushSubscription\.userId, resolved\.user\.id\)/);
  assert.match(pushTestApi, /Push test failed\. Check the reminder push service configuration\./);
  assert.doesNotMatch(pushTestApi, /pushReminderDelivery/);
  assert.match(pushReminderLib, /function cleanVapidKey/);
  assert.match(pushReminderLib, /base64UrlDecodedLength\(publicKey\) === 65/);
  assert.match(pushReminderLib, /base64UrlDecodedLength\(privateKey\) === 32/);
  assert.match(pushReminderLib, /webpush\.setVapidDetails\(subject, publicKey, privateKey\)/);
  assert.match(morningRoute, /export async function GET\(request: NextRequest\)/);
  assert.match(signInRoute, /export async function GET\(request: NextRequest\)/);
  assert.match(signOutRoute, /export async function GET\(request: NextRequest\)/);
  assert.match(morningRoute, /sendAttendanceReminderBatch\('holiday'\)/);
  assert.match(morningRoute, /sendAttendanceReminderBatch\('sign_in'\)/);
  assert.match(signInRoute, /sendAttendanceReminderBatch\('sign_in'\)/);
  assert.match(signOutRoute, /sendAttendanceReminderBatch\('sign_out'\)/);
  assert.match(holidayRoute, /sendAttendanceReminderBatch\('holiday'\)/);
  assert.match(morningRoute, /validateReminderCronRequest\(request, REMINDER_CRON_SCHEDULES\.morning\)/);
  assert.match(signInRoute, /validateReminderCronRequest\(request, REMINDER_CRON_SCHEDULES\.signIn\)/);
  assert.match(signOutRoute, /validateReminderCronRequest\(request, REMINDER_CRON_SCHEDULES\.signOut\)/);
  assert.match(holidayRoute, /validateReminderCronRequest\(request, REMINDER_CRON_SCHEDULES\.holiday\)/);
  assert.match(cronGuard, /process\.env\.CRON_SECRET/);
  assert.match(cronGuard, /vercel-cron\/1\.0/);
  assert.match(cronGuard, /x-latewatch-cron/);
  assert.match(cronGuard, /EXTERNAL_CRON_HEADER_VALUE = 'external'/);
  assert.match(cronGuard, /isVercelCron/);
  assert.match(cronGuard, /isExternalCron/);
  assert.match(cronGuard, /!isVercelCron && !isExternalCron/);
  assert.match(cronGuard, /x-vercel-cron-schedule/);
  assert.match(cronGuard, /if \(cronScheduleHeader && cronScheduleHeader !== schedule\.expectedSchedule\)/);
  assert.doesNotMatch(cronGuard, /if \(cronScheduleHeader !== schedule\.expectedSchedule\)/);
  assert.match(cronGuard, /getAccraClock\(\)/);
  assert.match(cronGuard, /REMINDER_CRON_WINDOW_MINUTES = 30/);
  assert.doesNotMatch(cronGuard, /allowWholeScheduledHour/);
  assert.match(cronGuard, /input\.scheduledHour \* 60 \+ input\.scheduledMinute/);
  assert.match(cronGuard, /isWithinAccraReminderCronWindow/);
  assert.match(proxy, /isCronReminderRoute/);
  assert.match(proxy, /\/api\/attendance\/reminders\(\.\*\)/);
  assert.match(proxy, /if \(isCronReminderRoute\(req\)\) \{\s*return NextResponse\.next\(\);\s*\}/);
  assert.equal(vercelConfig.crons.length, 2);
  assert.match(vercel, /"path": "\/api\/attendance\/reminders\/morning"[\s\S]*"schedule": "15 8 \* \* \*"/);
  assert.match(vercel, /"path": "\/api\/attendance\/reminders\/sign-out"[\s\S]*"schedule": "30 16 \* \* 1-5"/);
  assert.doesNotMatch(vercel, /"path": "\/api\/attendance\/reminders\/sign-in"/);
  assert.doesNotMatch(vercel, /"path": "\/api\/attendance\/reminders\/holiday"/);
  assert.doesNotMatch(vercel, /"path": "\/api\/calendar\/sync"/);
});

test('push client normalizes pasted VAPID public keys before browser subscribe', () => {
  require('tsx/cjs');
  const { normalizeVapidPublicKey, pushSubscriptionErrorMessage, vapidPublicKeyToUint8Array } = require(pushClientLibPath);
  const cleanKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
  const pastedKey = `\uFEFF ${cleanKey}\n`;

  assert.equal(normalizeVapidPublicKey(pastedKey), cleanKey);
  const decoded = vapidPublicKeyToUint8Array(pastedKey);
  assert.ok(decoded instanceof Uint8Array);
  assert.equal(decoded.length, 65);
  assert.equal(
    pushSubscriptionErrorMessage(new DOMException('Registration failed - push service error', 'AbortError')),
    'This browser could not connect to its push notification service. Open LateWatch in Chrome, Edge, or Safari, or enable Brave push messaging and try again.',
  );
});

test('attendance reminder notification titles include the staff first name', () => {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'server-only') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  const { reminderCopy } = require(pushReminderLibPath);
  Module._load = originalLoad;

  assert.equal(reminderCopy('sign_in', 'CARL CHRISTIAN QUIST').title, 'Carl, time to sign in');
  assert.equal(reminderCopy('sign_out', 'CARL CHRISTIAN QUIST').title, 'Carl, time to sign out');
  assert.equal(reminderCopy('holiday', 'CARL CHRISTIAN QUIST', { holidayName: 'Christmas Day' }).title, 'Carl, no check-in required on Holidays');
  assert.equal(reminderCopy('holiday', 'CARL CHRISTIAN QUIST', { holidayName: 'Christmas Day' }).body, 'Today is Christmas Day. No check-in is required.');
  assert.equal(reminderCopy('sign_in', '').title, 'Time to sign in');
});

test('holiday reminder source uses corrected work calendar data', () => {
  const source = fs.readFileSync(pushReminderLibPath, 'utf8');
  const attendanceSource = fs.readFileSync(attendanceLibPath, 'utf8');

  assert.match(source, /getHolidayForDate\(date\)/);
  assert.match(source, /const isHoliday = Boolean\(holiday\)/);
  assert.match(source, /reminderType === 'holiday'/);
  assert.match(source, /latewatch-holiday-reminder/);
  assert.match(attendanceSource, /eq\(workCalendar\.isHoliday, true\)/);
  assert.match(attendanceSource, /eq\(workCalendar\.isRemoved, false\)/);
  assert.doesNotMatch(source, /African Union Day/);
});

test('service worker displays push notifications and opens check-in', () => {
  assert.equal(fs.existsSync(serviceWorkerPath), true);
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');

  assert.match(source, /self\.addEventListener\('push'/);
  assert.match(source, /self\.registration\.showNotification/);
  assert.match(source, /self\.addEventListener\('notificationclick'/);
  assert.match(source, /payload\.data\?\.url/);
  assert.match(source, /event\.notification\.data\?\.url/);
  assert.match(source, /clients\.openWindow\(targetUrl\)/);
  assert.doesNotMatch(source, /clients\.openWindow\('\/check-in'\)/);
});

test('check-in page does not expose test reminder controls', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /sendPushReminderTest/);
  assert.doesNotMatch(source, /testingPushReminder/);
  assert.doesNotMatch(source, /onSendTest/);
  assert.doesNotMatch(source, /\/api\/attendance\/check-in\/push-subscription\/test/);
  assert.doesNotMatch(source, /Test reminder sent to/);
});

test('reminder toggle confirmation only appears when enabling reminders', () => {
  require('tsx/cjs');
  const {
    getEnabledReminderToggleConfirmation,
  } = require(pushReminderToggleConfirmationLibPath);
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.deepEqual(
    getEnabledReminderToggleConfirmation(
      { signInEnabled: false, signOutEnabled: false },
      { signInEnabled: true, signOutEnabled: false },
    ),
    {
      body: 'Sign-in reminder is now active on this device.',
      signInEnabled: true,
      signOutEnabled: false,
      title: 'Reminder turned on',
    },
  );
  assert.deepEqual(
    getEnabledReminderToggleConfirmation(
      { signInEnabled: false, signOutEnabled: false },
      { signInEnabled: true, signOutEnabled: true },
    ),
    {
      body: 'Sign-in and sign-out reminders are now active on this device.',
      signInEnabled: true,
      signOutEnabled: true,
      title: 'Reminder turned on',
    },
  );
  assert.deepEqual(
    getEnabledReminderToggleConfirmation(
      { signInEnabled: true, signOutEnabled: false },
      { signInEnabled: false, signOutEnabled: false },
    ),
    null,
  );
  assert.match(source, /showReminderToggleConfirmation/);
  assert.match(source, /registration\.showNotification\(confirmation\.title/);
  assert.match(source, /getEnabledReminderToggleConfirmation\(/);
  assert.match(source, /void showReminderToggleConfirmation\(enabledReminderConfirmation\)/);
});

test('reminder eligibility follows workday, permission, and attendance rules', () => {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'server-only') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  const { shouldSendPushReminder } = require(pushReminderLibPath);
  Module._load = originalLoad;

  const base = {
    isHoliday: false,
    isWeekend: false,
    staff: { active: true, archived: false, isAttendanceOnly: false },
    attendance: null,
    permission: null,
    subscription: { signInEnabled: true, signOutEnabled: true, disabledAt: null },
  };

  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in' }), true);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', attendance: { checkInTime: '08:10', signOutTime: null } }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', permission: { permissionType: 'absence' } }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', permission: { permissionType: 'late_arrival' } }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', isHoliday: true }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', staff: { active: true, archived: false, isAttendanceOnly: true } }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_in', subscription: { signInEnabled: false, signOutEnabled: true, disabledAt: null } }), false);

  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_out', attendance: { checkInTime: '08:10', signOutTime: null } }), true);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_out', attendance: { checkInTime: '08:10', signOutTime: '16:45' } }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_out', attendance: null }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'sign_out', subscription: { signInEnabled: true, signOutEnabled: false, disabledAt: null } }), false);

  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'holiday', isHoliday: true }), true);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'holiday', isHoliday: true, isWeekend: true }), true);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'holiday', isHoliday: false, isWeekend: true }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'holiday', isHoliday: false }), false);
  assert.equal(shouldSendPushReminder({ ...base, reminderType: 'holiday', isHoliday: true, subscription: { signInEnabled: false, signOutEnabled: false, disabledAt: null } }), false);
});
