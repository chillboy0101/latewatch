/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The attendance admin page was split in 502b6f5: /attendance is now a redirect and the
// table, permissions and pardon UI live under /attendance/overview.
const attendancePagePath = path.join(__dirname, '../src/app/attendance/overview/page.tsx');
const attendanceApiPath = path.join(__dirname, '../src/app/api/attendance/route.ts');
const attendanceCheckInApiPath = path.join(__dirname, '../src/app/api/attendance/check-in/route.ts');
const attendanceDeviceRoutePath = path.join(__dirname, '../src/app/api/attendance/devices/[staffId]/route.ts');
const deviceTransferRoutePath = path.join(__dirname, '../src/app/api/attendance/device-transfers/[id]/route.ts');
const attendancePermissionsApiPath = path.join(__dirname, '../src/app/api/attendance/permissions/route.ts');
const notificationsApiPath = path.join(__dirname, '../src/app/api/notifications/route.ts');
const deviceHealthApiPath = path.join(__dirname, '../src/app/api/attendance/device-health/route.ts');
const deviceHealthLibPath = path.join(__dirname, '../src/lib/device-session-health.ts');
const deviceHealthPagePath = path.join(__dirname, '../src/app/attendance/devices/page.tsx');
const securityAlertsApiPath = path.join(__dirname, '../src/app/api/attendance/security-alerts/route.ts');
const securityAlertsLibPath = path.join(__dirname, '../src/lib/security-alerts.ts');
const securityAlertsPagePath = path.join(__dirname, '../src/app/attendance/security-alerts/page.tsx');
const settingsSecurityPagePath = path.join(__dirname, '../src/app/settings/security/page.tsx');
const settingsPagePath = path.join(__dirname, '../src/app/settings/page.tsx');
const sidebarPath = path.join(__dirname, '../src/components/layout/sidebar.tsx');
const generalPardonApiPath = path.join(__dirname, '../src/app/api/attendance/permissions/general-pardon/route.ts');
const reconciliationPath = path.join(__dirname, '../src/lib/attendance-permission-reconciliation.ts');
const attendanceDeviceSecurityLibPath = path.join(__dirname, '../src/lib/attendance-device-security.ts');
const clerkSessionRevocationLibPath = path.join(__dirname, '../src/lib/clerk-session-revocation.ts');
const pushSubscriptionsLibPath = path.join(__dirname, '../src/lib/push-subscriptions.ts');
const schemaPath = path.join(__dirname, '../src/db/schema.ts');
const seedMigrateRoutePath = path.join(__dirname, '../src/app/api/seed/migrate/route.ts');
const attendanceDeviceSessionMigrationPath = path.join(__dirname, '../drizzle/0028_attendance_device_session_ids.sql');
const clerkSessionCleanupScriptPath = path.join(__dirname, '../scripts/cleanup-staff-sessions.mjs');
const packageJsonPath = path.join(__dirname, '../package.json');

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
  assert.match(source, /label="From"/);
  assert.match(source, /label="To"/);
  assert.match(source, /absenceEndDate/);
  assert.doesNotMatch(source, /permissionAbsenceWindow/);
  assert.doesNotMatch(source, /label="Absence Period"/);
  assert.doesNotMatch(source, /ABSENCE_PERMISSION_WINDOWS/);
  assert.doesNotMatch(source, /<TimeField/);
});

test('attendance permission modal contains the absence fields and actions', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /open=\{permissionDialogOpen\}/);
  assert.match(source, /New Permission/);
  assert.match(source, /Change Permission/);
  assert.match(source, /label="From"/);
  assert.match(source, /label="To"/);
  // Staff and dates stay editable, so a permission saved on the wrong day can be moved.
  assert.doesNotMatch(source, /disabled=\{isEditingPermission\}/);
  assert.match(source, /replacesPermissionId/);
  assert.match(source, /Approve Permission/);
  assert.match(source, /Update Permission/);
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
  assert.match(source, /Apply pardon/);
  assert.match(source, /Full-day excuse/);
  assert.match(source, /Late-only pardon/);
  assert.match(source, /generalPardonType/);
  assert.match(source, /setGeneralPardonOpen\(true\)/);
  assert.match(source, /\/api\/attendance\/permissions\/general-pardon/);
  assert.match(source, /skippedCount/);
  assert.match(source, /skipped \(on leave or deactivated\)/);
});

test('attendance page lets admins change an existing permission from the permission list', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /openNewPermissionDialog/);
  assert.match(source, /setPermissionDialogOpen\(true\)/);
  assert.match(source, />\s*New Permission\s*</);
  assert.match(source, /startPermissionEdit\(permission: AttendancePermission\)/);
  assert.match(source, /setEditingPermissionId\(permission\.id\)/);
  assert.match(source, /setPermissionDialogOpen\(true\)/);
  // Staff and dates stay editable, so a permission saved on the wrong day can be moved.
  assert.doesNotMatch(source, /disabled=\{isEditingPermission\}/);
  assert.match(source, /replacesPermissionId/);
  assert.match(source, /Update Permission/);
  assert.match(source, /Permission updated\./);
  assert.match(source, />\s*Change\s*</);
  assert.match(source, />\s*Cancel\s*</);
});

test('general pardon API preserves existing permissions while attaching a durable pardon override', () => {
  assert.equal(fs.existsSync(generalPardonApiPath), true);
  const source = fs.readFileSync(generalPardonApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /pardonType/);
  assert.match(source, /Invalid pardon type/);
  // Everyone on staff that day, by their type history (as the attendance page lists them).
  assert.match(source, /const members = await staffOnDate\(await db\.select\(\{/);
  assert.match(source, /isAttendanceOnly: staff\.isAttendanceOnly/);
  assert.match(source, /isNssPersonnel: staff\.isNssPersonnel/);
  assert.match(source, /reason: 'general pardon'/);
  assert.match(source, /generalPardonType: pardonType/);
  assert.match(source, /\.set\(\{\s*generalPardonType: pardonType,\s*updatedAt: now/s);
  assert.doesNotMatch(source, /existingReason !== 'general pardon'/);
  assert.match(source, /financialReviewRequiredCount: financialReviewRequired\.length/);
  assert.match(source, /reconciliation\.financialReviewRequired/);
  assert.match(source, /reconcileAttendanceForPermission/);
  assert.match(source, /entityType: 'attendance_general_pardon'/);
});

test('general pardon UI reports late amounts held for financial review', () => {
  const pageSource = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(pageSource, /financialReviewRequiredCount/);
  assert.match(pageSource, /allocated payments require financial review/);
});

test('general pardon override has a database migration and seed fallback', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../drizzle/0032_attendance_permission_general_pardons.sql'),
    'utf8',
  );
  const seedMigration = fs.readFileSync(path.join(__dirname, '../src/app/api/seed/migrate/route.ts'), 'utf8');

  assert.match(migration, /general_pardon_type text/);
  assert.match(migration, /IN \('absence', 'late_arrival'\)/);
  assert.match(seedMigration, /ADD COLUMN IF NOT EXISTS general_pardon_type text/);
});

test('general pardon reconciliation clears late records and keeps late-only missing staff unchecked', () => {
  const reconciliationSource = fs.readFileSync(reconciliationPath, 'utf8');
  const attendanceApiSource = fs.readFileSync(attendanceApiPath, 'utf8');
  const permissionsSource = fs.readFileSync(attendancePermissionsApiPath, 'utf8');

  assert.match(reconciliationSource, /permission\.permissionType === 'absence'/);
  assert.match(reconciliationSource, /status: 'excused'/);
  assert.match(reconciliationSource, /publishRealtime\('payments'/);
  assert.match(reconciliationSource, /publishRealtime\('staff-penalty-history'/);
  // Paid and pardoned entries both need a financial review instead of being rewritten.
  assert.match(reconciliationSource, /getFinanciallyProtectedLeaveEntryIds\(\[existingLateness\.id\]\)/);
  assert.match(reconciliationSource, /financial_review_required/);
  assert.match(reconciliationSource, /NO_SHOW_SIGN_IN_REASON/);
  assert.match(reconciliationSource, /staffMember\.isAttendanceOnly === true/);
  assert.match(permissionsSource, /isAttendanceOnly: member\.isAttendanceOnly/);
  assert.match(attendanceApiSource, /syncLatenessEntriesFromAttendanceForDate\(date\)/);
  assert.match(attendanceApiSource, /isGeneralPardonReason\(permission\.reason\)/);
  assert.match(attendanceApiSource, /return 'not_checked_in'/);
});

test('general pardon invalidates entries and payment balances', () => {
  const source = fs.readFileSync(generalPardonApiPath, 'utf8');

  assert.match(source, /publishRealtime\('entries'/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /publishRealtime\('staff-penalty-history'/);
  assert.match(source, /publishRealtime\('audit-trail'/);
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

test('attendance present and on-time filters stay distinct', () => {
  const pageSource = fs.readFileSync(attendancePagePath, 'utf8');
  const apiSource = fs.readFileSync(attendanceApiPath, 'utf8');

  assert.match(pageSource, /type AttendanceFilter = 'all' \| 'on_time' \| AttendanceStatus/);
  assert.match(pageSource, /label="Present"[\s\S]*onClick=\{\(\) => setActiveFilter\('present'\)\}[\s\S]*value=\{data\?\.totals\.present \?\? 0\}/);
  assert.match(pageSource, /label="On Time"[\s\S]*onClick=\{\(\) => setActiveFilter\('on_time'\)\}[\s\S]*value=\{data\?\.totals\.onTime \?\? 0\}/);
  assert.match(pageSource, /activeFilter === 'present'[\s\S]*row\.attendance\?\.checkInTime/);
  assert.match(pageSource, /activeFilter === 'on_time'[\s\S]*isOnTimeAttendanceRow\(row\)/);
  assert.match(pageSource, /if \(status === 'present'\) return 'On Time'/);
  assert.match(pageSource, /auto-cols-\[minmax\(7\.75rem,1fr\)\][\s\S]*xl:grid-cols-10/);

  assert.match(apiSource, /if \(row\.attendance\?\.checkInTime\) acc\.present \+= 1/);
  // On time: checked in on time and not on leave (one group per person); the page uses the same rule.
  assert.match(apiSource, /if \(isOnTimeAttendanceRow\(row\) && !row\.statuses\.includes\('on_leave'\)\) acc\.onTime \+= 1;\s*if \(row\.statuses\.includes\('late'\)\) acc\.late \+= 1/);
  assert.match(pageSource, /return isOnTimeCheckIn\(row\.attendance\?\.checkInTime\) && !rowStatuses\(row\)\.includes\('on_leave'\);/);
  assert.match(apiSource, /if \(row\.statuses\.includes\('not_checked_in'\)\) acc\.notCheckedIn \+= 1/);
  assert.doesNotMatch(apiSource, /else acc\.notCheckedIn \+= 1/);
  assert.doesNotMatch(apiSource, /if \(row\.status === 'present'\) acc\.onTime \+= 1/);
  assert.match(apiSource, /onTime: 0/);
});

test('late and no-sign-out attendance rows stay visible in both status filters', () => {
  const pageSource = fs.readFileSync(attendancePagePath, 'utf8');
  const apiSource = fs.readFileSync(attendanceApiPath, 'utf8');

  assert.match(apiSource, /getAttendanceStatusFlags/);
  assert.match(apiSource, /const statuses = getAttendanceStatusFlags/);
  assert.match(apiSource, /row\.statuses\.includes\('late'\)/);
  assert.match(apiSource, /row\.statuses\.includes\('no_sign_out'\)/);
  assert.doesNotMatch(apiSource, /noSignOut\s*\?\s*'no_sign_out'\s*:\s*attendance\?\.status/);

  assert.match(pageSource, /rowStatuses\(row\)\.includes\(activeFilter\)/);
  assert.match(pageSource, /rowStatuses\(row\)\.map\(\(status\)/);
});

test('staff sign-out syncs penalties and invalidates entries and payment views', () => {
  const source = fs.readFileSync(attendanceCheckInApiPath, 'utf8');

  assert.match(source, /syncLatenessEntriesFromAttendanceForDate/);
  assert.match(source, /await syncLatenessEntriesFromAttendanceForDate\(clock\.dateKey\)/);
  assert.match(source, /publishRealtime\('entries', 'invalidate', \{ reason: 'attendance-sign-out' \}\)/);
  assert.match(source, /publishRealtime\('payments', 'invalidate', \{ date: clock\.dateKey, reason: 'attendance-sign-out' \}\)/);
  assert.match(source, /publishRealtime\('staff-penalty-history', 'invalidate', \{ date: clock\.dateKey, reason: 'attendance-sign-out' \}\)/);
});

test('system notifications read weekly penalties without running reconciliation', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.doesNotMatch(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /const weekEntries = await db\.select/);
});

test('notifications endpoint isolates audit and system notification failures', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /safeNotificationTask/);
  assert.match(source, /Failed to build audit notifications/);
  assert.match(source, /Failed to build system notifications/);
  assert.doesNotMatch(source, /Promise\.all\(\[\s*getAuditNotifications/);
});

test('audit-backed system announcements render as system notifications', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /event\.entityType === 'system'/);
  assert.match(source, /notificationTitle/);
  assert.match(source, /notificationMessage/);
  assert.match(source, /category: 'system'/);
});

test('system no-sign-out notifications ignore waived rows', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /noSignOutWaived:\s*attendanceRecord\.noSignOutWaived/);
  assert.match(source, /!row\.signOutTime && row\.noSignOutWaived !== true/);
});

test('staff device update notifications are not shown as device resets', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /shouldSkipAuditNotificationEvent/);
  assert.match(source, /autoCheckInEnabled/);
  assert.match(source, /autoSignOutEnabled/);
  assert.match(source, /filter\(\(event\) => !shouldSkipAuditNotificationEvent\(event\)\)/);
  assert.match(source, /Attendance device updated/);
  assert.doesNotMatch(source, /case 'UPDATE':[\s\S]*Attendance device reset[\s\S]*can link a new check-in device[\s\S]*case 'DELETE':/);
});

test('notifications suppress device reset notices after the staff device is relinked', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /staffDevice/);
  assert.match(source, /getResolvedDeviceResetEventIds/);
  assert.match(source, /inArray\(staffDevice\.staffId, staffIds\)/);
  assert.match(source, /resolvedDeviceResetEventIds\.has\(event\.id\)/);
});

test('attendance device reset also disables old push notification subscriptions', () => {
  const route = fs.readFileSync(attendanceDeviceRoutePath, 'utf8');
  const helper = fs.readFileSync(pushSubscriptionsLibPath, 'utf8');
  const page = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(helper, /pushSubscription/);
  assert.match(helper, /eq\(pushSubscription\.staffId, staffId\)/);
  assert.match(helper, /isNull\(pushSubscription\.disabledAt\)/);
  assert.match(helper, /disabledAt/);
  assert.match(helper, /signInEnabled: false/);
  assert.match(helper, /signOutEnabled: false/);
  assert.match(helper, /return disabledSubscriptions\.length/);
  assert.match(route, /disableActivePushSubscriptionsForStaff\(staffId, now\)/);
  assert.match(route, /disabledPushSubscriptions/);
  assert.ok(route.indexOf('disableActivePushSubscriptionsForStaff(staffId, now)') < route.indexOf('if (before)'));
  // Sessions and reminders are revoked even with no device linked, so every reset is audited.
  assert.ok(route.indexOf('if (before)') < route.indexOf('await writeAuditEvent({'));
  assert.match(route, /deviceRemoved: Boolean\(before\)/);
  assert.match(route, /publishRealtime\('attendance', 'invalidate', \{ reason: 'attendance-device-reset' \}\)/);
  assert.match(page, /old notification device/);
  assert.match(page, /Reminders must be enabled again on the new device/);
});

test('attendance device reset revokes staff Clerk sessions before device cleanup', () => {
  const route = fs.readFileSync(attendanceDeviceRoutePath, 'utf8');
  const helper = fs.readFileSync(clerkSessionRevocationLibPath, 'utf8');

  assert.match(helper, /createClerkClient/);
  assert.match(helper, /client\.users\.getUser\(userId\)/);
  assert.match(helper, /findUserByEmail\(client, input\.staffEmail\)/);
  assert.match(helper, /client\.sessions\.getSessionList\(\{[\s\S]*status: 'active'[\s\S]*userId/);
  assert.match(helper, /client\.sessions\.revokeSession\(session\.id\)/);
  assert.match(helper, /StaffSessionRevocationError/);
  assert.match(route, /revokeStaffLoginSessions\(\{\s*deviceUserId: before\?\.userId,\s*staffEmail: member\.email/);
  assert.match(route, /revokedSessions/);
  assert.match(route, /sessionRevocation/);
  assert.match(route, /SESSION_REVOCATION_FAILED/);
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('disableActivePushSubscriptionsForStaff(staffId, now)'));
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('if (before)'));
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('await db.delete(staffDevice)'));
});

test('attendance transfer stores Clerk session ids for targeted old-device logout', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seedMigration = fs.readFileSync(seedMigrateRoutePath, 'utf8');
  const migration = fs.readFileSync(attendanceDeviceSessionMigrationPath, 'utf8');
  const checkInRoute = fs.readFileSync(attendanceCheckInApiPath, 'utf8');
  const transferRoute = fs.readFileSync(deviceTransferRoutePath, 'utf8');
  const helper = fs.readFileSync(clerkSessionRevocationLibPath, 'utf8');

  assert.match(schema, /clerkSessionId: text\('clerk_session_id'\)/);
  assert.match(migration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS clerk_session_id text/);
  assert.match(migration, /ALTER TABLE device_transfer_request ADD COLUMN IF NOT EXISTS clerk_session_id text/);
  assert.match(seedMigration, /ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS clerk_session_id text/);
  assert.match(seedMigration, /ALTER TABLE device_transfer_request ADD COLUMN IF NOT EXISTS clerk_session_id text/);
  assert.match(checkInRoute, /import \{ auth, currentUser \} from '@clerk\/nextjs\/server'/);
  assert.equal((checkInRoute.match(/const session = await auth\(\);/g) || []).length, 2);
  assert.match(checkInRoute, /const clerkSessionId = session\.sessionId \|\| null/);
  assert.match(checkInRoute, /clerkSessionId: input\.clerkSessionId \|\| device\.clerkSessionId/);
  assert.match(checkInRoute, /clerkSessionId: input\.clerkSessionId,/);
  assert.match(checkInRoute, /clerkSessionId: input\.clerkSessionId \|\| currentDevice\.clerkSessionId/);
  assert.match(checkInRoute, /resolvedDevice\.clerkSessionId !== clerkSessionId/);
  assert.match(checkInRoute, /await db\.update\(staffDevice\)[\s\S]*clerkSessionId,[\s\S]*where\(eq\(staffDevice\.id, resolvedDevice\.id\)\)/);
  assert.match(checkInRoute, /const transferValues = \{[\s\S]*clerkSessionId,[\s\S]*deviceHash: trustedDeviceHash/);
  assert.match(transferRoute, /const oldTrustedSessionId = beforeDevice\?\.clerkSessionId && beforeDevice\.clerkSessionId !== transfer\.clerkSessionId/);
  assert.match(transferRoute, /sessionId: oldTrustedSessionId/);
  assert.match(transferRoute, /clerkSessionId: transfer\.clerkSessionId/);
  assert.match(helper, /export async function revokeStaffLoginSessionById/);
  assert.match(helper, /client\.sessions\.getSession\(input\.sessionId\)/);
  assert.match(helper, /status: 'no_session_id'/);
});

test('device transfer approval disables push subscriptions but rejection does not', () => {
  const route = fs.readFileSync(deviceTransferRoutePath, 'utf8');
  const page = fs.readFileSync(attendancePagePath, 'utf8');
  const notifications = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(route, /disableActivePushSubscriptionsForStaff\(transfer\.staffId, now\)/);
  assert.match(route, /let disabledPushSubscriptions = 0/);
  assert.match(route, /disabledPushSubscriptions/);
  assert.match(route, /return NextResponse\.json\(\{\s*disabledPushSubscriptions/);
  assert.doesNotMatch(route, /action === 'reject'[\s\S]{0,300}disableActivePushSubscriptionsForStaff/);
  assert.match(page, /Device transfer approved/);
  assert.match(page, /Device transfer rejected/);
  assert.match(page, /old notification device/);
  assert.match(page, /Reminders must be enabled again on the new device/);
  assert.match(notifications, /staff_device_transfer/);
  assert.match(notifications, /Device transfer requested/);
  assert.match(notifications, /Device transfer approved/);
  assert.match(notifications, /Device transfer rejected/);
  assert.match(notifications, /Reminders must be enabled again on the new device/);
});

test('device transfer approval revokes old sessions while preserving the new trusted-device session', () => {
  const route = fs.readFileSync(deviceTransferRoutePath, 'utf8');
  const helper = fs.readFileSync(clerkSessionRevocationLibPath, 'utf8');

  assert.match(route, /revokeStaffLoginSessionById\(\{\s*expectedUserId: beforeDevice\?\.userId \|\| transfer\.userId,\s*sessionId: oldTrustedSessionId/);
  assert.match(route, /revokeStaffLoginSessionsExcept\(\{\s*deviceUserId: beforeDevice\?\.userId \|\| transfer\.userId,\s*keepSessionId: transfer\.clerkSessionId,\s*staffEmail: member\?\.email/);
  assert.match(route, /if \(!transfer\.clerkSessionId\)/);
  assert.match(route, /TRANSFER_SESSION_REQUIRED/);
  assert.match(route, /sessionRevocation\.status === 'keep_session_not_active'/);
  assert.match(route, /TRANSFER_SESSION_NOT_ACTIVE/);
  assert.doesNotMatch(route, /revokeStaffLoginSessions\(/);
  assert.match(route, /let revokedSessions = 0/);
  assert.match(route, /let sessionRevocation: StaffSessionRevocationResult \| null = null/);
  assert.match(route, /revokedSessions/);
  assert.match(route, /sessionRevocation/);
  assert.match(route, /SESSION_REVOCATION_FAILED/);
  assert.match(helper, /export async function revokeStaffLoginSessionsExcept/);
  assert.match(helper, /const keepSessionIsActive = sessions\.some/);
  assert.match(helper, /sessions\.filter\(\(session\) => session\.id !== input\.keepSessionId\)/);
  assert.match(helper, /status: 'keep_session_not_active'/);
  assert.match(helper, /status: 'no_extra_sessions'/);
  assert.ok(route.indexOf('revokeStaffLoginSessionById({') < route.indexOf('const deviceValues = {'));
  assert.ok(route.indexOf('revokeStaffLoginSessionsExcept({') < route.indexOf('const deviceValues = {'));
  assert.ok(route.indexOf('const deviceValues = {') < route.indexOf('await db.insert(staffDevice)'));
  assert.doesNotMatch(route, /action === 'reject'[\s\S]{0,600}revokeStaffLoginSession/);
});

test('device health dashboard exposes trusted devices, reminder devices, session cleanup, and reset controls', () => {
  assert.equal(fs.existsSync(deviceHealthApiPath), true);
  assert.equal(fs.existsSync(deviceHealthLibPath), true);
  assert.equal(fs.existsSync(deviceHealthPagePath), true);

  const api = fs.readFileSync(deviceHealthApiPath, 'utf8');
  const helper = fs.readFileSync(deviceHealthLibPath, 'utf8');
  const page = fs.readFileSync(deviceHealthPagePath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(api, /enforceRole\(\['admin'\]\)/);
  assert.match(api, /getDeviceSessionHealth/);
  assert.match(api, /Cache-Control': 'no-store'/);
  assert.match(helper, /staffDevice/);
  assert.match(helper, /pushSubscription/);
  assert.match(helper, /deviceTransferRequest/);
  assert.match(helper, /auditEvent/);
  assert.match(helper, /clerkSessionId/);
  assert.match(helper, /revokedSessionsFromAudit/);
  assert.match(helper, /Legacy trusted device: open Check-In on this device to refresh session/);
  assert.match(helper, /Multiple notification devices/);
  assert.match(page, /\/api\/attendance\/device-health/);
  assert.match(page, /Search staff/);
  // Minimal table: the device badge says the state (with help on hover); sign-in and sign-out
  // are one word each, the full reason on hover.
  assert.match(page, /'Refresh session'/);
  assert.match(page, /function shortIssue\(reason: string\)/);
  assert.match(page, /subscribeRealtimeChannel/);
  assert.match(page, /Updated \{accraTime\(data\.generatedAt\)\}/);
  assert.match(page, /<th className="px-4 py-3 font-medium">Device<\/th>/);
  assert.match(page, /<th className="w-28 px-4 py-3 font-medium">Sign-in<\/th>/);
  assert.match(page, /<th className="w-28 px-4 py-3 font-medium">Sign-out<\/th>/);
  assert.match(page, /title=\{cell\.reason\}/);
  assert.match(page, /\/api\/attendance\/devices\/\$\{resetTarget\.staff\.id\}/);
  assert.match(page, /They&apos;re signed out everywhere and reminders switch off/);
  assert.doesNotMatch(helper, /Multiple active reminder devices/);
  assert.doesNotMatch(page, /Session not tracked/);
  assert.doesNotMatch(page, /Trusted device has no stored Clerk session/);
  assert.match(sidebar, /href: '\/attendance\/devices'/);
});

// The security-alerts dashboard (page, API route and lib) was removed in 502b6f5, so the
// test that guarded it is gone with it. Its audit ALERT rows are still written by the
// check-in route and remain visible in the audit trail.
test('the removed security-alerts dashboard has not crept back in', () => {
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');

  assert.equal(fs.existsSync(securityAlertsApiPath), false);
  assert.equal(fs.existsSync(securityAlertsLibPath), false);
  assert.equal(fs.existsSync(securityAlertsPagePath), false);
  assert.doesNotMatch(sidebar, /security-alerts/);
});

test('the old Settings, Security and Account pages are gone; old links redirect', () => {
  const nextConfig = fs.readFileSync(path.join(__dirname, '../next.config.ts'), 'utf8');
  assert.equal(fs.existsSync(settingsSecurityPagePath), false);
  assert.equal(fs.existsSync(settingsPagePath), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/app/account')), false);
  assert.match(nextConfig, /source: "\/settings"/);
  assert.match(nextConfig, /source: "\/account\/:path\*"/);
});

test('Clerk session cleanup script is dry-run first and preserves trusted attendance sessions', () => {
  const script = fs.readFileSync(clerkSessionCleanupScriptPath, 'utf8');
  const packageJson = fs.readFileSync(packageJsonPath, 'utf8');

  assert.match(packageJson, /"clerk:sessions:cleanup": "node scripts\/cleanup-staff-sessions\.mjs"/);
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /Dry run by default/);
  assert.match(script, /sd\.clerk_session_id as "trustedSessionId"/);
  assert.match(script, /skippedMissingTrustedSession/);
  assert.match(script, /sessions\.some\(\(session\) => session\.id === staffMember\.trustedSessionId\)/);
  assert.match(script, /sessions\.filter\(\(session\) => session\.id !== staffMember\.trustedSessionId\)/);
  assert.match(script, /await clerk\.sessions\.revokeSession\(session\.id\)/);
  assert.match(script, /Run with --apply/);
});

test('check-in status returns current device transfer review state', () => {
  const source = fs.readFileSync(attendanceCheckInApiPath, 'utf8');

  assert.match(source, /currentDeviceTransfer/);
  assert.match(source, /eq\(deviceTransferRequest\.deviceHash, deviceHash\)/);
  assert.match(source, /const statusTransfer = pendingTransfer \|\| currentDeviceTransfer \|\| null/);
  assert.match(source, /transferRequest: statusTransfer/);
});

test('a device transfer can be requested any day, from anywhere; check-ins keep every gate', () => {
  const source = fs.readFileSync(attendanceCheckInApiPath, 'utf8');
  const transfer = source.indexOf("if (action === 'request_device_transfer')");

  // Handled before the weekend, holiday and office-location gates, which stay for check-ins.
  assert.ok(transfer > -1);
  assert.ok(transfer < source.indexOf("return block('WEEKEND_CLOSED'"));
  assert.ok(transfer < source.indexOf("'HOLIDAY_CLOSED',"));
  assert.ok(transfer < source.indexOf('if (!locationValidation.ok)'));
  // The location is still read and kept with the request for the admin, but never blocks it.
  const branch = source.slice(transfer, source.indexOf("return block('WEEKEND_CLOSED'"));
  assert.match(branch, /const locationValidation = validateRequestLocation\(officeLocation\);/);
  assert.match(branch, /\.\.\.locationForDb\(locationValidation\)/);
  assert.doesNotMatch(branch, /if \(!locationValidation\.ok\)/);
  assert.match(branch, /isWeekend: isWeekendDate\(clock\.dateKey\)/);
  assert.match(source, /body\?\.action === 'request_device_transfer'/);

  // The phone sends it even when location is off.
  const page = fs.readFileSync(path.join(__dirname, '../src/app/check-in/page.tsx'), 'utf8');
  // Straight away, with the best reading it already has (never waiting for a new one).
  assert.match(page, /const location = pickReading\(readingsRef\.current\) \?\? null;/);
});

test('attendance device binding rejects browser tokens already linked to another active staff member', () => {
  const route = fs.readFileSync(attendanceCheckInApiPath, 'utf8');
  const helper = fs.readFileSync(attendanceDeviceSecurityLibPath, 'utf8');

  assert.match(helper, /findSharedAttendanceDeviceOwner/);
  assert.match(helper, /eq\(staffDevice\.deviceHash, input\.deviceHash\)/);
  assert.match(helper, /ne\(staffDevice\.staffId, input\.staffId\)/);
  assert.match(helper, /or\(eq\(staff\.active, true\), isNull\(staff\.active\)\)/);
  assert.match(helper, /or\(eq\(staff\.archived, false\), isNull\(staff\.archived\)\)/);
  assert.match(route, /const sharedDeviceOwner = await findSharedAttendanceDeviceOwner\(\{\s*deviceHash: input\.deviceHash/);
  assert.match(route, /SHARED_ATTENDANCE_DEVICE_MESSAGE/);
  assert.match(route, /SHARED_ATTENDANCE_DEVICE_RESULT/);
  assert.ok(route.indexOf('deviceHash: input.deviceHash') < route.indexOf('const [createdDevice] = await db.insert(staffDevice)'));
});

test('check-in and transfer request block reused attendance devices before binding or requesting transfer', () => {
  const route = fs.readFileSync(attendanceCheckInApiPath, 'utf8');

  // One shared check (audited, then refused) for both.
  assert.match(route, /async function blockSharedDevice\(/);
  assert.match(route, /reason: 'attendance-shared-device-block',/);
  assert.match(route, /return block\(SHARED_ATTENDANCE_DEVICE_RESULT, SHARED_ATTENDANCE_DEVICE_MESSAGE, 403,/);
  const sharedCheck = 'const sharedDeviceBlock = await blockSharedDevice(staffMember, trustedDeviceHash, locationValidation, officeLocationExtra);';
  // A transfer request runs it first, inside its own branch, before any request is written.
  const transfer = route.indexOf("if (action === 'request_device_transfer')");
  const transferSharedCheck = route.indexOf(sharedCheck, transfer);
  assert.ok(transfer > -1 && transferSharedCheck > transfer);
  assert.ok(transferSharedCheck < route.indexOf('const transferGate = await allowRequest('));
  // Check-ins run it before binding a device.
  const checkInSharedCheck = route.indexOf(sharedCheck, route.indexOf("return block('WEEKEND_CLOSED'"));
  assert.ok(checkInSharedCheck > -1);
  assert.ok(checkInSharedCheck < route.indexOf('async function syncTrustedDevice()'));
  assert.match(route, /entityType: 'staff_device'/);
  assert.match(route, /linkedStaffId: input\.sharedDeviceOwner\.staffId/);
});

test('device transfer approval rejects shared attendance devices before upsert', () => {
  const route = fs.readFileSync(deviceTransferRoutePath, 'utf8');

  assert.match(route, /findSharedAttendanceDeviceOwner\(\{\s*deviceHash: transfer\.deviceHash,\s*staffId: transfer\.staffId/);
  assert.match(route, /SHARED_ATTENDANCE_DEVICE_MESSAGE/);
  assert.match(route, /SHARED_ATTENDANCE_DEVICE_RESULT/);
  assert.match(route, /status: 409/);
  assert.match(route, /reason: 'attendance-device-transfer-shared-device-block'/);
  assert.ok(route.indexOf('const sharedDeviceOwner = await findSharedAttendanceDeviceOwner') < route.indexOf('const deviceValues = {'));
  assert.ok(route.indexOf('error: SHARED_ATTENDANCE_DEVICE_MESSAGE') < route.indexOf('await db.insert(staffDevice)'));
});

test('late arrival permissions can cover a date range like excused absences', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'attendance', 'permissions', 'route.ts'), 'utf8');

  assert.match(source, /label="From"/);
  assert.match(source, /label="To"/);
  assert.match(source, /absenceEndDate: permissionAbsenceEndDate,\n\s+arrivalWindow: permissionWindow,\n\s+date: permissionAbsenceStartDate,/);
  assert.match(route, /appliedDates = date === endDate \? \[date\] : getInclusivePermissionDateRange\(date, endDate\);/);
  assert.doesNotMatch(route, /const nonWorkdayLabel = await getNonWorkdayLabel\(date\);/);
});
