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
const signInReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-in/route.ts');
const signOutReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-out/route.ts');
const pushClientLibPath = path.join(root, 'src/lib/push-client.ts');
const pushReminderLibPath = path.join(root, 'src/lib/push-reminders.ts');
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
  assert.match(source, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
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
  assert.equal(fs.existsSync(signInReminderRoutePath), true);
  assert.equal(fs.existsSync(signOutReminderRoutePath), true);

  const pushApi = fs.readFileSync(pushApiPath, 'utf8');
  const signInRoute = fs.readFileSync(signInReminderRoutePath, 'utf8');
  const signOutRoute = fs.readFileSync(signOutReminderRoutePath, 'utf8');
  const vercel = fs.readFileSync(vercelPath, 'utf8');

  assert.match(pushApi, /export async function GET/);
  assert.match(pushApi, /export async function PUT/);
  assert.match(pushApi, /export async function DELETE/);
  assert.match(pushApi, /pushSubscription/);
  assert.match(signInRoute, /sendAttendanceReminderBatch\('sign_in'\)/);
  assert.match(signOutRoute, /sendAttendanceReminderBatch\('sign_out'\)/);
  assert.match(vercel, /"path": "\/api\/attendance\/reminders\/sign-in"[\s\S]*"schedule": "15 8 \* \* 1-5"/);
  assert.match(vercel, /"path": "\/api\/attendance\/reminders\/sign-out"[\s\S]*"schedule": "30 16 \* \* 1-5"/);
});

test('push client normalizes pasted VAPID public keys before browser subscribe', () => {
  require('tsx/cjs');
  const { normalizeVapidPublicKey, vapidPublicKeyToUint8Array } = require(pushClientLibPath);
  const cleanKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
  const pastedKey = `\uFEFF ${cleanKey}\n`;

  assert.equal(normalizeVapidPublicKey(pastedKey), cleanKey);
  const decoded = vapidPublicKeyToUint8Array(pastedKey);
  assert.ok(decoded instanceof Uint8Array);
  assert.equal(decoded.length, 65);
});

test('service worker displays push notifications and opens check-in', () => {
  assert.equal(fs.existsSync(serviceWorkerPath), true);
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');

  assert.match(source, /self\.addEventListener\('push'/);
  assert.match(source, /self\.registration\.showNotification/);
  assert.match(source, /self\.addEventListener\('notificationclick'/);
  assert.match(source, /clients\.openWindow\('\/check-in'\)/);
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
});
