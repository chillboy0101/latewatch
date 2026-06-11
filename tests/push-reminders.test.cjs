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
const cronJobOrgSetupApiPath = path.join(root, 'src/app/api/admin/cron-job-org/reminders/setup/route.ts');
const cronJobOrgSetupLibPath = path.join(root, 'src/lib/cron-job-org-reminder-setup.ts');
const cronJobOrgSetupSettingsPath = path.join(root, 'src/app/settings/reminder-scheduler/route.ts');
const morningReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/morning/route.ts');
const proofTestReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/proof-test/route.ts');
const signInReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-in/route.ts');
const signOutReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/sign-out/route.ts');
const holidayReminderRoutePath = path.join(root, 'src/app/api/attendance/reminders/holiday/route.ts');
const proxyPath = path.join(root, 'src/proxy.ts');
const pushClientLibPath = path.join(root, 'src/lib/push-client.ts');
const pushReminderProofTestLibPath = path.join(root, 'src/lib/push-reminder-proof-test.ts');
const reminderDeliveryMonitorLibPath = path.join(root, 'src/lib/reminder-delivery-monitor.ts');
const reminderDeliveryMonitorApiPath = path.join(root, 'src/app/api/attendance/reminder-monitor/route.ts');
const reminderDeliveryMonitorPagePath = path.join(root, 'src/app/attendance/reminders/page.tsx');
const pushReminderToggleConfirmationLibPath = path.join(root, 'src/lib/push-reminder-toggle-confirmation.ts');
const pushReminderLibPath = path.join(root, 'src/lib/push-reminders.ts');
const reminderCronGuardPath = path.join(root, 'src/lib/reminder-cron-guard.ts');
const cronJobOrgScriptPath = path.join(root, 'scripts/setup-cron-job-org-reminders.mjs');
const attendanceLibPath = path.join(root, 'src/lib/attendance.ts');
const serviceWorkerPath = path.join(root, 'public/sw.js');
const vercelPath = path.join(root, 'vercel.json');

test('push reminder package, schema, migration, and seed repair are defined', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seedMigration = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.ok(pkg.dependencies?.['web-push']);
  assert.equal(pkg.scripts?.['cronjob-org:reminders'], 'node scripts/setup-cron-job-org-reminders.mjs');
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

test('cron-job.org setup script creates reminder catch-up jobs with protected headers', () => {
  assert.equal(fs.existsSync(cronJobOrgScriptPath), true);
  const source = fs.readFileSync(cronJobOrgScriptPath, 'utf8');

  assert.match(source, /https:\/\/api\.cron-job\.org/);
  assert.match(source, /CRONJOB_ORG_API_KEY/);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /CRON_JOB_ORG_WRITE_DELAY_MS = 750/);
  assert.match(source, /await wait\(CRON_JOB_ORG_WRITE_DELAY_MS\)/);
  assert.match(source, /LateWatch morning reminder 8AM catch-up/);
  assert.match(source, /LateWatch morning reminder daytime catch-up/);
  assert.match(source, /\/api\/attendance\/reminders\/morning/);
  assert.match(source, /hours: \[8\]/);
  assert.match(source, /minutes: \[15, 20, 25, 30, 35, 40, 45, 50, 55\]/);
  assert.match(source, /hours: \[9, 10, 11, 12, 13, 14, 15, 16\]/);
  assert.match(source, /LateWatch sign-out reminder 4PM catch-up/);
  assert.match(source, /LateWatch sign-out reminder evening catch-up/);
  assert.match(source, /\/api\/attendance\/reminders\/sign-out/);
  assert.match(source, /hours: \[16\]/);
  assert.match(source, /minutes: \[30, 35, 40, 45, 50, 55\]/);
  assert.match(source, /hours: \[17, 18, 19, 20, 21, 22, 23\]/);
  assert.match(source, /wdays: \[1, 2, 3, 4, 5\]/);
  assert.match(source, /Authorization: `Bearer \$\{CRON_SECRET\}`/);
  assert.match(source, /'x-latewatch-cron': 'external'/);
  assert.match(source, /method: 'PUT'/);
  assert.match(source, /method: 'PATCH'/);
});

test('admin cron-job.org setup API uses Vercel cron secret without exposing it', () => {
  assert.equal(fs.existsSync(cronJobOrgSetupApiPath), true);
  assert.equal(fs.existsSync(cronJobOrgSetupLibPath), true);
  assert.equal(fs.existsSync(cronJobOrgSetupSettingsPath), true);
  const apiSource = fs.readFileSync(cronJobOrgSetupApiPath, 'utf8');
  const helperSource = fs.readFileSync(cronJobOrgSetupLibPath, 'utf8');
  const settingsSource = fs.readFileSync(cronJobOrgSetupSettingsPath, 'utf8');

  assert.match(apiSource, /requireRole\(\['admin'\]\)/);
  assert.match(apiSource, /export async function GET/);
  assert.match(apiSource, /export async function POST/);
  assert.match(apiSource, /process\.env\.CRON_SECRET/);
  assert.match(apiSource, /setupCronJobOrgReminderJobs/);
  assert.match(apiSource, /schedulerRequestFromSetupRequest/);
  assert.match(settingsSource, /\/settings\/reminder-scheduler/);
  assert.match(settingsSource, /requireRole\(\['admin'\]\)/);
  assert.match(settingsSource, /setupResultHtml/);
  assert.match(settingsSource, /setupCronJobOrgReminderJobs/);
  assert.match(settingsSource, /scheduleCronJobOrgProofTest/);
  assert.match(settingsSource, /schedulerRequest\.action === 'proof-test'/);
  assert.match(helperSource, /method="post"/);
  assert.match(helperSource, /name="apiKey"/);
  assert.match(helperSource, /name="proofTestTime"/);
  assert.match(helperSource, /Schedule proof test/);
  assert.match(helperSource, /PROOF_TEST_JOB_TITLE = 'LateWatch scheduled proof test'/);
  assert.match(helperSource, /proofTestScheduleForAccraTime/);
  assert.match(helperSource, /expiresAt: formatCronJobOrgExpiresAt/);
  assert.match(helperSource, /\/api\/attendance\/reminders\/proof-test\?testId=/);
  assert.match(helperSource, /request\.formData\(\)/);
  assert.match(helperSource, /body\?\.apiKey/);
  assert.match(helperSource, /process\.env\.CRONJOB_ORG_API_KEY/);
  assert.match(helperSource, /CRON_JOB_ORG_WRITE_DELAY_MS = 750/);
  assert.match(helperSource, /await wait\(CRON_JOB_ORG_WRITE_DELAY_MS\)/);
  assert.match(helperSource, /Authorization: `Bearer \$\{input\.cronSecret\}`/);
  assert.match(helperSource, /'x-latewatch-cron': 'external'/);
  assert.match(helperSource, /https:\/\/api\.cron-job\.org/);
  assert.match(helperSource, /method: 'PUT'/);
  assert.match(helperSource, /method: 'PATCH'/);
  assert.match(helperSource, /LateWatch morning reminder 8AM catch-up/);
  assert.match(helperSource, /LateWatch morning reminder daytime catch-up/);
  assert.match(helperSource, /LateWatch sign-out reminder 4PM catch-up/);
  assert.match(helperSource, /LateWatch sign-out reminder evening catch-up/);
  assert.doesNotMatch(apiSource, /console\.log\(.*apiKey/);
  assert.doesNotMatch(apiSource, /console\.log\(.*cronSecret/);
  assert.doesNotMatch(helperSource, /console\.log\(.*apiKey/);
  assert.doesNotMatch(helperSource, /console\.log\(.*cronSecret/);
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
  assert.match(source, /LOCAL_CATCH_UP_REMINDER_STORAGE_PREFIX/);
  assert.match(source, /getLocalCatchUpReminder\(status, pushReminderStatus\)/);
  assert.match(source, /if \(!status\.device\?\.registered \|\| !status\.device\.trusted\) return null/);
  assert.match(source, /if \(status\.transferRequest\?\.status === 'pending'\) return null/);
  assert.match(source, /localCatchUpReminderStorageKey\(status, reminder\.reminderType\)/);
  assert.match(source, /showLocalCatchUpReminder\(reminder\)/);
  assert.match(source, /window\.localStorage\.setItem\(storageKey, 'pending'\)/);
  assert.match(source, /window\.localStorage\.removeItem\(storageKey\)/);
  assert.match(source, /source: 'local_catch_up'/);
  assert.match(source, /requireInteraction: true/);
  assert.match(source, /renotify: true/);
  assert.match(source, /const reminderControlsLocked = Boolean\(!status\?\.device\?\.registered \|\| !status\.device\.trusted\)/);
  assert.match(source, /disabled=\{!status\?\.staff \|\| reminderControlsLocked \|\| pushReminderLoading \|\| savingPushReminder\}/);
  assert.match(source, /'x-latewatch-device': deviceToken/);
  assert.match(source, /JSON\.stringify\(\{ deviceToken, endpoint: currentEndpoint \}\)/);
  assert.match(source, /deviceToken,\s+signInEnabled: next\.signInEnabled/);
  assert.match(source, /DEVICE_TRANSFER_REVIEW_STORAGE_PREFIX/);
  assert.match(source, /device_transfer_review/);
  assert.match(source, /Device transfer approved/);
  assert.match(source, /const transferRequestPending = status\?\.transferRequest\?\.status === 'pending'/);
  assert.match(source, /This browser could not be identified\. Refresh the page and try again\./);
  assert.match(source, /disabled=\{requestingTransfer \|\| transferRequestPending\}/);
  assert.doesNotMatch(source, /disabled=\{requestingTransfer \|\| transferRequestPending \|\| locationBlocksAction\}/);
  assert.match(source, /\? 'Checking location\.\.\.'/);
  assert.match(source, /\? 'Transfer Request Pending'/);
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
  assert.equal(fs.existsSync(proofTestReminderRoutePath), true);
  assert.equal(fs.existsSync(pushReminderProofTestLibPath), true);
  assert.equal(fs.existsSync(signInReminderRoutePath), true);
  assert.equal(fs.existsSync(signOutReminderRoutePath), true);
  assert.equal(fs.existsSync(holidayReminderRoutePath), true);
  assert.equal(fs.existsSync(reminderCronGuardPath), true);

  const pushApi = fs.readFileSync(pushApiPath, 'utf8');
  const pushTestApi = fs.readFileSync(pushTestApiPath, 'utf8');
  const proofTestRoute = fs.readFileSync(proofTestReminderRoutePath, 'utf8');
  const proofTestLib = fs.readFileSync(pushReminderProofTestLibPath, 'utf8');
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
  assert.match(pushApi, /staffDevice/);
  assert.match(pushApi, /getDeviceTokenFromRequest/);
  assert.match(pushApi, /hashDeviceToken/);
  assert.match(pushApi, /UNTRUSTED_REMINDER_DEVICE_ERROR = 'Transfer this device before changing reminder notifications\.'/);
  assert.match(pushApi, /requireTrustedAttendanceDevice/);
  assert.match(pushApi, /eq\(staffDevice\.staffId, staffId\)/);
  assert.match(pushApi, /device\.deviceHash !== deviceHash/);
  assert.match(pushApi, /const trustedDeviceError = await requireTrustedAttendanceDevice\(request, resolved\.staffMember\.id, body\)/);
  assert.match(pushApi, /if \(trustedDeviceError\) return trustedDeviceError/);
  assert.match(pushApi, /disableOtherActivePushSubscriptions/);
  assert.match(pushApi, /ne\(pushSubscription\.endpoint, input\.endpoint\)/);
  assert.match(pushApi, /signInEnabled: false/);
  assert.match(pushApi, /signOutEnabled: false/);
  assert.match(pushApi, /getVapidPublicKey/);
  assert.match(pushApi, /publishRealtime\('attendance', 'invalidate', \{ reason: 'push-subscription-change' \}\)/);
  assert.match(pushApi, /publishRealtime\('notifications', 'invalidate', \{ reason: 'push-subscription-change' \}\)/);
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
  assert.match(proofTestRoute, /validateReminderCronAuth\(request\)/);
  assert.match(proofTestRoute, /sendReminderProofTestBatch\(testId\)/);
  assert.match(proofTestRoute, /searchParams\.get\('testId'\)/);
  assert.match(proofTestLib, /webpush\.sendNotification/);
  assert.match(proofTestLib, /pushSubscription/);
  assert.match(proofTestLib, /or\(eq\(pushSubscription\.signInEnabled, true\), eq\(pushSubscription\.signOutEnabled, true\)\)/);
  assert.match(proofTestLib, /latewatch-reminder-proof-test-\$\{testId\}/);
  assert.match(proofTestLib, /requireInteraction: true/);
  assert.match(proofTestLib, /renotify: true/);
  assert.match(proofTestLib, /TTL: 15 \* 60/);
  assert.match(proofTestLib, /signInEnabled: false/);
  assert.match(proofTestLib, /signOutEnabled: false/);
  assert.doesNotMatch(proofTestRoute, /pushReminderDelivery/);
  assert.doesNotMatch(proofTestLib, /pushReminderDelivery/);
  assert.match(pushReminderLib, /function cleanVapidKey/);
  assert.match(pushReminderLib, /base64UrlDecodedLength\(publicKey\) === 65/);
  assert.match(pushReminderLib, /base64UrlDecodedLength\(privateKey\) === 32/);
  assert.match(pushReminderLib, /webpush\.setVapidDetails\(subject, publicKey, privateKey\)/);
  assert.match(pushReminderLib, /reminderPushTtlSeconds/);
  assert.match(pushReminderLib, /TTL: reminderPushTtlSeconds\(reminderType, clock\.timeKey\)/);
  assert.match(pushReminderLib, /requireInteraction: true/);
  assert.match(pushReminderLib, /renotify: true/);
  assert.match(pushReminderLib, /reservePushReminderDelivery/);
  assert.match(pushReminderLib, /existingDelivery\.status === 'sent'/);
  assert.match(pushReminderLib, /existingDelivery\.status === 'disabled'/);
  assert.match(pushReminderLib, /existingDelivery\.status === 'pending' && !isStalePendingDelivery\(existingDelivery\)/);
  assert.match(pushReminderLib, /publishReminderMonitorRefresh\(summary\)/);
  assert.match(pushReminderLib, /reason: 'push-reminder-batch'/);
  assert.match(pushReminderLib, /publishRealtime\('attendance', 'invalidate'/);
  assert.match(pushReminderLib, /publishRealtime\('notifications', 'invalidate'/);
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
  assert.match(cronGuard, /validateReminderCronAuth/);
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
  assert.match(cronGuard, /MORNING_REMINDER_CRON_WINDOW_MINUTES = 526/);
  assert.match(cronGuard, /SIGN_OUT_REMINDER_CRON_WINDOW_MINUTES = 450/);
  assert.match(cronGuard, /windowMinutes: MORNING_REMINDER_CRON_WINDOW_MINUTES/);
  assert.match(cronGuard, /windowMinutes: SIGN_OUT_REMINDER_CRON_WINDOW_MINUTES/);
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

test('admin reminder delivery monitor is protected and explains delivery outcomes', () => {
  assert.equal(fs.existsSync(reminderDeliveryMonitorLibPath), true);
  assert.equal(fs.existsSync(reminderDeliveryMonitorApiPath), true);
  assert.equal(fs.existsSync(reminderDeliveryMonitorPagePath), true);

  const helper = fs.readFileSync(reminderDeliveryMonitorLibPath, 'utf8');
  const api = fs.readFileSync(reminderDeliveryMonitorApiPath, 'utf8');
  const page = fs.readFileSync(reminderDeliveryMonitorPagePath, 'utf8');
  const proxy = fs.readFileSync(proxyPath, 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/layout/sidebar.tsx'), 'utf8');

  assert.match(api, /requireRole\(\['admin'\]\)/);
  assert.match(api, /getReminderDeliveryMonitor\(date\)/);
  assert.match(api, /isIsoDateKey\(date\)/);
  assert.match(api, /Cache-Control': 'no-store'/);
  assert.match(proxy, /\/api\/attendance\/reminders\(\.\*\)/);
  assert.doesNotMatch(api, /validateReminderCronAuth/);
  assert.doesNotMatch(api, /\/api\/attendance\/reminders/);

  assert.match(helper, /pushReminderDelivery/);
  assert.match(helper, /pushSubscription/);
  assert.match(helper, /staffDevice/);
  assert.match(helper, /attendanceRecord/);
  assert.match(helper, /attendancePermission/);
  assert.match(helper, /getHolidayForDate\(date\)/);
  assert.match(helper, /isWeekendDate\(date\)/);
  assert.match(helper, /Eligible but no delivery record found/);
  assert.match(helper, /No trusted attendance device/);
  assert.match(helper, /Notifications not registered/);
  assert.match(helper, /Sign-in reminder off/);
  assert.match(helper, /Sign-out reminder off/);
  assert.match(helper, /Already signed in at/);
  assert.match(helper, /Already signed out at/);
  assert.match(helper, /sentReason\(\{ attendance, reminderType, sent: counts\.sent \}\)/);
  assert.ok(helper.indexOf('counts.sent > 0') < helper.indexOf("reminderType === 'sign_in' && attendance?.checkInTime"));
  assert.ok(helper.indexOf('counts.sent > 0') < helper.indexOf("reminderType === 'sign_out' && attendance?.signOutTime"));
  assert.match(helper, /const summary = \{/);
  assert.match(helper, /missing: rows\.filter\(\(row\) => row\.status === 'missing'\)\.length/);
  assert.match(helper, /noTrustedDevice: rows\.filter\(\(row\) => row\.status === 'no_trusted_device'\)\.length/);
  assert.match(helper, /notificationsNotRegistered: rows\.filter\(\(row\) => row\.status === 'notifications_not_registered'\)\.length/);
  assert.match(helper, /reminderOff: rows\.filter\(\(row\) => row\.status === 'reminder_off'\)\.length/);
  assert.match(helper, /eligible staff but zero successful sends/);
  assert.match(helper, /staff have no trusted attendance device/);
  assert.match(helper, /trusted device but have not registered browser notifications/);
  assert.match(helper, /notification devices but this reminder toggle is off/);
  assert.match(helper, /scheduledPassed/);
  assert.doesNotMatch(helper, /No enabled sign-in reminder device/);
  assert.doesNotMatch(helper, /No enabled sign-out reminder device/);

  assert.match(page, /Reminder Monitor/);
  assert.match(page, /\/api\/attendance\/reminder-monitor\?date=/);
  assert.match(page, /Search/);
  assert.match(page, /Status/);
  assert.match(page, /value="sent"/);
  assert.match(page, /value="no_trusted_device"/);
  assert.match(page, /value="notifications_not_registered"/);
  assert.match(page, /value="reminder_off"/);
  assert.match(page, /Needs Review/);
  assert.match(page, /No trusted device/);
  assert.match(page, /Notifications not registered/);
  assert.match(page, /Reminder off/);
  assert.match(page, /Last updated/);
  assert.match(page, /subscribeRealtimeChannel/);
  assert.match(page, /SummaryFilter active=\{statusFilter === 'sent'\}/);
  assert.match(page, /No reminder rows in this filter/);
  assert.doesNotMatch(page, /send test reminder|resend reminder|manual resend/i);
  assert.match(page, /section\.alerts\.map/);
  assert.match(page, /ReminderSection section=\{filteredSections\.signIn\}/);
  assert.match(page, /ReminderSection section=\{filteredSections\.signOut\}/);
  assert.match(sidebar, /Reminders/);
  assert.match(sidebar, /href: '\/attendance\/reminders'/);
  assert.match(sidebar, /activeNavigation/);
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
  assert.equal(reminderCopy('sign_in', 'CARL CHRISTIAN QUIST').requireInteraction, true);
  assert.equal(reminderCopy('sign_in', 'CARL CHRISTIAN QUIST').renotify, true);
  assert.equal(reminderCopy('sign_out', 'CARL CHRISTIAN QUIST').title, 'Carl, time to sign out');
  assert.equal(reminderCopy('sign_out', 'CARL CHRISTIAN QUIST').requireInteraction, true);
  assert.equal(reminderCopy('sign_out', 'CARL CHRISTIAN QUIST').renotify, true);
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

test('check-in page keeps reminder controls compact and refreshes after device security events', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /PermissionSetupPanel/);
  assert.doesNotMatch(source, /SetupStep/);
  assert.doesNotMatch(source, /label="Location"/);
  assert.doesNotMatch(source, /label="Notifications"/);
  assert.doesNotMatch(source, /label="Reminders"/);
  assert.match(source, /useClerk/);
  assert.match(source, /handleSessionInvalidated/);
  assert.match(source, /Your device was reset or transferred\. Sign in again on the trusted device\./);
  assert.match(source, /signOut\(\{ redirectUrl: '\/sign-in' \}\)/);
  assert.match(source, /\['attendance', 'notifications'\]\.map/);
  assert.match(source, /fetchStatus\(\{ preserveMessage: true, silent: true \}\)/);
  assert.match(source, /fetchPushReminderStatus\(\{ silent: true \}\)/);
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
