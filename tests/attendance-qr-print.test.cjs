/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const attendancePagePath = path.join(__dirname, '../src/app/attendance/page.tsx');
const attendanceApiPath = path.join(__dirname, '../src/app/api/attendance/route.ts');
const attendancePermissionsApiPath = path.join(__dirname, '../src/app/api/attendance/permissions/route.ts');
const generalPardonApiPath = path.join(__dirname, '../src/app/api/attendance/permissions/general-pardon/route.ts');
const reconciliationPath = path.join(__dirname, '../src/lib/attendance-permission-reconciliation.ts');

test('attendance QR print sheet does not show the raw install URL text', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /Scan to install LateWatch or open attendance\./);
  assert.doesNotMatch(source, /<p class="url">\$\{qrData\.checkInUrl\}<\/p>/);
});

test('attendance permission form uses selected reasons for late arrivals and absences', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /ABSENCE_PERMISSION_REASONS/);
  assert.match(source, /LATE_ARRIVAL_PERMISSION_REASONS/);
  assert.match(source, /permissionType === 'absence'\s*\?/);
  assert.match(source, /<option value="">Select late arrival reason<\/option>/);
  assert.match(source, /<option value="">Select absence reason<\/option>/);
  assert.doesNotMatch(source, /placeholder="Enter late arrival reason"/);
  assert.match(source, /formatAbsencePermissionReason\(permission\.reason\)/);
});

test('attendance permission form exposes absence date range without period controls', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /permissionAbsenceEndDate/);
  assert.match(source, /label="Absence Start"/);
  assert.match(source, /label="Absence End"/);
  assert.match(source, /absenceEndDate/);
  assert.doesNotMatch(source, /permissionAbsenceWindow/);
  assert.doesNotMatch(source, /label="Absence Period"/);
  assert.doesNotMatch(source, /ABSENCE_PERMISSION_WINDOWS/);
  assert.doesNotMatch(source, /<TimeField/);
});

test('attendance permission absence fields align across full desktop rows', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /permissionType === 'absence' \? 'xl:col-span-3' : 'xl:col-span-2'/);
  assert.match(source, /className="xl:col-span-3"\s+label="Absence Start"/);
  assert.match(source, /className="xl:col-span-3"\s+label="Absence End"/);
  assert.match(source, /className="xl:col-span-10"[\s\S]*<option value="">Select absence reason<\/option>/);
});

test('attendance permission API validates both permission reason lists and full-day absences', () => {
  const source = fs.readFileSync(attendancePermissionsApiPath, 'utf8');

  assert.match(source, /normalizeAbsencePermissionReason\(reason\)/);
  assert.match(source, /normalizeLateArrivalPermissionReason\(reason\)/);
  assert.match(source, /arrivalWindow = 'full_day'/);
  assert.match(source, /expectedEndTime = null/);
  assert.match(source, /expectedStartTime = null/);
});

test('attendance page confirms general pardons before calling the bulk endpoint', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /Grant General Pardon/);
  assert.match(source, /Confirm General Pardon/);
  assert.match(source, /Full-day excuse/);
  assert.match(source, /Late-only pardon/);
  assert.match(source, /generalPardonType/);
  assert.match(source, /setGeneralPardonOpen\(true\)/);
  assert.match(source, /\/api\/attendance\/permissions\/general-pardon/);
});

test('general pardon API bulk applies to all active attendance staff and audits the summary', () => {
  assert.equal(fs.existsSync(generalPardonApiPath), true);
  const source = fs.readFileSync(generalPardonApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /pardonType/);
  assert.match(source, /Invalid pardon type/);
  assert.match(source, /eq\(staff\.active, true\)/);
  assert.match(source, /eq\(staff\.archived, false\)/);
  assert.match(source, /isAttendanceOnly: staff\.isAttendanceOnly/);
  assert.match(source, /isNssPersonnel: staff\.isNssPersonnel/);
  assert.match(source, /reason: 'general pardon'/);
  assert.match(source, /reconcileAttendanceForPermission/);
  assert.match(source, /entityType: 'attendance_general_pardon'/);
});

test('general pardon reconciliation clears late records and keeps late-only missing staff unchecked', () => {
  const reconciliationSource = fs.readFileSync(reconciliationPath, 'utf8');
  const attendanceApiSource = fs.readFileSync(attendanceApiPath, 'utf8');

  assert.match(reconciliationSource, /permission\.permissionType === 'absence'/);
  assert.match(reconciliationSource, /status: 'excused'/);
  assert.match(attendanceApiSource, /isGeneralPardonReason\(permission\.reason\)/);
  assert.match(attendanceApiSource, /return 'not_checked_in'/);
});

test('attendance permission list falls back to loaded staff names', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /const staffNameById = useMemo\(\(\) => new Map/);
  assert.match(source, /staffNameById\.get\(permission\.staffId\)/);
  assert.match(source, /permission\.staffName \|\| staffNameById\.get\(permission\.staffId\) \|\| 'Staff member'/);
});

test('attendance API includes staff names for permission rows', () => {
  const source = fs.readFileSync(attendanceApiPath, 'utf8');

  assert.match(source, /staffName: staff\.fullName/);
  assert.match(source, /staffEmail: staff\.email/);
  assert.match(source, /leftJoin\(staff, eq\(attendancePermission\.staffId, staff\.id\)\)/);
});
