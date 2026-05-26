/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'src/db/schema.ts');
const migrationPath = path.join(root, 'drizzle/0020_auto_attendance_device_settings.sql');
const checkInRoutePath = path.join(root, 'src/app/api/attendance/check-in/route.ts');
const autoSettingsRoutePath = path.join(root, 'src/app/api/attendance/check-in/auto-settings/route.ts');
const checkInPagePath = path.join(root, 'src/app/check-in/page.tsx');
const attendanceRoutePath = path.join(root, 'src/app/api/attendance/route.ts');
const attendancePagePath = path.join(root, 'src/app/attendance/page.tsx');

test('legacy trusted-device auto columns remain for non-destructive migration safety', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(schema, /autoCheckInEnabled: boolean\('auto_check_in_enabled'\)\.default\(false\)\.notNull\(\)/);
  assert.match(schema, /autoSignOutEnabled: boolean\('auto_sign_out_enabled'\)\.default\(false\)\.notNull\(\)/);
  assert.match(migration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_check_in_enabled boolean DEFAULT false NOT NULL/);
  assert.match(migration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_sign_out_enabled boolean DEFAULT false NOT NULL/);
});

test('auto attendance settings endpoint is retired from the app surface', () => {
  const checkInPage = fs.readFileSync(checkInPagePath, 'utf8');
  const checkInRoute = fs.readFileSync(checkInRoutePath, 'utf8');
  const attendanceRoute = fs.readFileSync(attendanceRoutePath, 'utf8');
  const attendancePage = fs.readFileSync(attendancePagePath, 'utf8');

  assert.equal(fs.existsSync(autoSettingsRoutePath), false);
  assert.doesNotMatch(checkInPage, /\/api\/attendance\/check-in\/auto-settings/);
  assert.doesNotMatch(checkInPage, /source: 'auto_attendance'/);
  assert.doesNotMatch(checkInPage, /Auto check-in|Auto sign-out|AutoAttendancePanel/);
  assert.doesNotMatch(checkInRoute, /body\?\.source === 'auto_attendance'/);
  assert.doesNotMatch(checkInRoute, /autoCheckInEnabled: Boolean\(device\?\.autoCheckInEnabled\)/);
  assert.doesNotMatch(attendanceRoute, /autoCheckInEnabled: staffDevice\.autoCheckInEnabled/);
  assert.doesNotMatch(attendancePage, /Auto in|Auto out/);
});

test('check-in API repairs legacy entries fallback sign-outs', () => {
  const route = fs.readFileSync(checkInRoutePath, 'utf8');

  assert.match(route, /isLegacyEntriesFallbackSignOut/);
  assert.match(route, /normalizeTimeKey\(attendance\.signOutTime\) === '17:00'/);
  assert.match(route, /attendance\.signOutNetworkIp === 'manual_admin'/);
  assert.match(route, /clearLegacyEntriesFallbackSignOut/);
  assert.match(route, /signOutTime: null/);
  assert.match(route, /attendance-sign-out-repair/);
});

test('check-in page renders push reminder controls instead of auto actions', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /ReminderNotificationPanel/);
  assert.match(source, /Enable sign-in reminder/);
  assert.match(source, /Enable sign-out reminder/);
  assert.match(source, /\/api\/attendance\/check-in\/push-subscription/);
  assert.match(source, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.doesNotMatch(source, /Auto check-in|Auto sign-out|auto_attendance/);
});
