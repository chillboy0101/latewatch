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
const autoAttendanceHelperPath = path.join(root, 'src/lib/auto-attendance.ts');

test('trusted devices store auto attendance toggles with a migration', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(schema, /autoCheckInEnabled: boolean\('auto_check_in_enabled'\)\.default\(false\)\.notNull\(\)/);
  assert.match(schema, /autoSignOutEnabled: boolean\('auto_sign_out_enabled'\)\.default\(false\)\.notNull\(\)/);
  assert.match(migration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_check_in_enabled boolean DEFAULT false NOT NULL/);
  assert.match(migration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_sign_out_enabled boolean DEFAULT false NOT NULL/);
});

test('auto settings endpoint updates only the signed-in trusted device', () => {
  assert.equal(fs.existsSync(autoSettingsRoutePath), true);
  const source = fs.readFileSync(autoSettingsRoutePath, 'utf8');

  assert.match(source, /export async function PATCH/);
  assert.match(source, /currentUser\(\)/);
  assert.match(source, /getDeviceTokenFromRequest\(request, body\)/);
  assert.match(source, /eq\(staffDevice\.deviceHash, trustedDeviceHash\)/);
  assert.match(source, /autoCheckInEnabled/);
  assert.match(source, /autoSignOutEnabled/);
  assert.match(source, /entityType: 'staff_device'/);
  assert.match(source, /publishRealtime\('attendance'/);
});

test('check-in APIs expose and accept auto attendance source', () => {
  const route = fs.readFileSync(checkInRoutePath, 'utf8');
  const attendanceRoute = fs.readFileSync(attendanceRoutePath, 'utf8');

  assert.match(route, /body\?\.source === 'auto_attendance'/);
  assert.match(route, /autoCheckInEnabled: Boolean\(device\?\.autoCheckInEnabled\)/);
  assert.match(route, /autoSignOutEnabled: Boolean\(device\?\.autoSignOutEnabled\)/);
  assert.match(attendanceRoute, /autoCheckInEnabled: staffDevice\.autoCheckInEnabled/);
  assert.match(attendanceRoute, /autoSignOutEnabled: staffDevice\.autoSignOutEnabled/);
});

test('check-in page renders independent auto toggles and calls auto settings/action APIs', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /Auto check-in/);
  assert.match(source, /Auto sign-out/);
  assert.match(source, /\/api\/attendance\/check-in\/auto-settings/);
  assert.match(source, /source: 'auto_attendance'/);
  assert.match(source, /autoCheckInEnabled/);
  assert.match(source, /autoSignOutEnabled/);
  assert.match(source, /Auto attendance active|Waiting for office location|Auto sign-out off/);
});

test('admin attendance page exposes auto attendance device badges', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /autoCheckInEnabled: boolean/);
  assert.match(source, /autoSignOutEnabled: boolean/);
  assert.match(source, /Auto in/);
  assert.match(source, /Auto out/);
});

test('auto attendance resolver waits for office location and debounces late-day sign-out', () => {
  require('tsx/cjs');
  const {
    AUTO_ATTENDANCE_DEBOUNCE_MS,
    resolveAutoAttendanceAction,
  } = require(autoAttendanceHelperPath);

  assert.equal(resolveAutoAttendanceAction({
    autoCheckInEnabled: true,
    autoSignOutEnabled: true,
    canCheckIn: true,
    canSubmitSignOut: false,
    officeVerified: false,
  }), null);

  assert.equal(resolveAutoAttendanceAction({
    autoCheckInEnabled: true,
    autoSignOutEnabled: false,
    canCheckIn: true,
    canSubmitSignOut: false,
    officeVerified: true,
  }), 'check_in');

  assert.equal(resolveAutoAttendanceAction({
    autoCheckInEnabled: false,
    autoSignOutEnabled: true,
    canCheckIn: false,
    canSubmitSignOut: true,
    lastAutoActionAt: 10_000,
    now: 10_000 + AUTO_ATTENDANCE_DEBOUNCE_MS - 1,
    officeVerified: true,
  }), null);

  assert.equal(resolveAutoAttendanceAction({
    autoCheckInEnabled: false,
    autoSignOutEnabled: true,
    canCheckIn: false,
    canSubmitSignOut: true,
    lastAutoActionAt: 10_000,
    now: 10_000 + AUTO_ATTENDANCE_DEBOUNCE_MS + 1,
    officeVerified: true,
  }), 'sign_out');
});
