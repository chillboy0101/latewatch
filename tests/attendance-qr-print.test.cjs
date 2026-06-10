/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const attendancePagePath = path.join(__dirname, '../src/app/attendance/page.tsx');
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
  assert.match(source, /label="Absence Start"/);
  assert.match(source, /label="Absence End"/);
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
  assert.match(source, /label="Absence Start"/);
  assert.match(source, /label="Absence End"/);
  assert.match(source, /disabled=\{isEditingPermission\}/);
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
  assert.match(source, /existing permission/);
});

test('attendance page lets admins change an existing permission from the permission list', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /openNewPermissionDialog/);
  assert.match(source, /setPermissionDialogOpen\(true\)/);
  assert.match(source, />\s*New Permission\s*</);
  assert.match(source, /startPermissionEdit\(permission: AttendancePermission\)/);
  assert.match(source, /setEditingPermissionId\(permission\.id\)/);
  assert.match(source, /setPermissionDialogOpen\(true\)/);
  assert.match(source, /disabled=\{isEditingPermission\}/);
  assert.match(source, /Update Permission/);
  assert.match(source, /Permission updated\./);
  assert.match(source, />\s*Change\s*</);
  assert.match(source, />\s*Cancel\s*</);
});

test('general pardon API bulk applies to active staff and skips existing specific permissions', () => {
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
  assert.match(source, /skippedPermissions/);
  assert.match(source, /existingReason !== 'general pardon'/);
  assert.match(source, /continue;/);
  assert.match(source, /skippedCount: skippedPermissions\.length/);
  assert.match(source, /reconcileAttendanceForPermission/);
  assert.match(source, /entityType: 'attendance_general_pardon'/);
});

test('general pardon reconciliation clears late records and keeps late-only missing staff unchecked', () => {
  const reconciliationSource = fs.readFileSync(reconciliationPath, 'utf8');
  const attendanceApiSource = fs.readFileSync(attendanceApiPath, 'utf8');

  assert.match(reconciliationSource, /permission\.permissionType === 'absence'/);
  assert.match(reconciliationSource, /status: 'excused'/);
  assert.match(reconciliationSource, /publishRealtime\('payments'/);
  assert.match(reconciliationSource, /publishRealtime\('staff-penalty-history'/);
  assert.match(attendanceApiSource, /syncLatenessEntriesFromAttendanceForDate\(date\)/);
  assert.match(attendanceApiSource, /isGeneralPardonReason\(permission\.reason\)/);
  assert.match(attendanceApiSource, /return 'not_checked_in'/);
});

test('general pardon invalidates entries and payment balances', () => {
  const source = fs.readFileSync(generalPardonApiPath, 'utf8');

  assert.match(source, /publishRealtime\('entries'/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /publishRealtime\('staff-penalty-history'/);
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
  assert.match(pageSource, /auto-cols-\[minmax\(7\.75rem,1fr\)\][\s\S]*xl:grid-cols-9/);

  assert.match(apiSource, /if \(row\.attendance\?\.checkInTime\) acc\.present \+= 1/);
  assert.match(apiSource, /if \(isOnTimeAttendanceRow\(row\)\) acc\.onTime \+= 1/);
  assert.match(apiSource, /if \(isOnTimeAttendanceRow\(row\)\) acc\.onTime \+= 1;\s*if \(row\.statuses\.includes\('late'\)\) acc\.late \+= 1/);
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

test('system notifications sync lateness before reading weekly penalty totals', () => {
  const source = fs.readFileSync(notificationsApiPath, 'utf8');

  assert.match(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /await syncLatenessEntriesFromAttendanceForRange\(weekStart, todayStr\)[\s\S]*const weekEntries/);
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
  assert.ok(route.indexOf('disableActivePushSubscriptionsForStaff(staffId, now)') < route.indexOf('if (!before)'));
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
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('if (!before)'));
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

test('device health dashboard exposes trusted devices, reminder devices, and session cleanup', () => {
  assert.equal(fs.existsSync(deviceHealthApiPath), true);
  assert.equal(fs.existsSync(deviceHealthLibPath), true);
  assert.equal(fs.existsSync(deviceHealthPagePath), true);

  const api = fs.readFileSync(deviceHealthApiPath, 'utf8');
  const helper = fs.readFileSync(deviceHealthLibPath, 'utf8');
  const page = fs.readFileSync(deviceHealthPagePath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(api, /requireRole\(\['admin'\]\)/);
  assert.match(api, /getDeviceSessionHealth/);
  assert.match(api, /Cache-Control': 'no-store'/);
  assert.match(helper, /staffDevice/);
  assert.match(helper, /pushSubscription/);
  assert.match(helper, /deviceTransferRequest/);
  assert.match(helper, /auditEvent/);
  assert.match(helper, /clerkSessionId/);
  assert.match(helper, /revokedSessionsFromAudit/);
  assert.match(helper, /Multiple active reminder devices/);
  assert.match(page, /Device \+ Session Health/);
  assert.match(page, /\/api\/attendance\/device-health/);
  assert.match(page, /Trusted Device/);
  assert.match(page, /Reminder Devices/);
  assert.match(page, /revoked sessions/);
  assert.match(sidebar, /href: '\/attendance\/devices'/);
});

test('security alerts dashboard surfaces suspicious attendance audit alerts', () => {
  assert.equal(fs.existsSync(securityAlertsApiPath), true);
  assert.equal(fs.existsSync(securityAlertsLibPath), true);
  assert.equal(fs.existsSync(securityAlertsPagePath), true);

  const api = fs.readFileSync(securityAlertsApiPath, 'utf8');
  const helper = fs.readFileSync(securityAlertsLibPath, 'utf8');
  const page = fs.readFileSync(securityAlertsPagePath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(api, /requireRole\(\['admin'\]\)/);
  assert.match(api, /getSecurityAlerts/);
  assert.match(api, /Cache-Control': 'no-store'/);
  assert.match(helper, /eq\(auditEvent\.action, 'ALERT'\)/);
  assert.match(helper, /SHARED_ATTENDANCE_DEVICE/);
  assert.match(helper, /REGISTERED_DEVICE_REQUIRED/);
  assert.match(helper, /TRANSFER_SESSION_REQUIRED/);
  assert.match(helper, /critical/);
  assert.match(page, /Admin Security Alerts/);
  assert.match(page, /\/api\/attendance\/security-alerts/);
  assert.match(page, /Recent Alerts/);
  assert.match(sidebar, /href: '\/attendance\/security-alerts'/);
});

test('security settings page documents MFA and passkey handoff through Clerk', () => {
  assert.equal(fs.existsSync(settingsSecurityPagePath), true);
  const page = fs.readFileSync(settingsSecurityPagePath, 'utf8');
  const settingsPage = fs.readFileSync(settingsPagePath, 'utf8');

  assert.match(page, /Security Hardening/);
  assert.match(page, /Clerk multi-factor authentication/);
  assert.match(page, /Enable passkeys where available/);
  assert.match(page, /Open Clerk Dashboard/);
  assert.match(page, /\/attendance\/security-alerts/);
  assert.match(settingsPage, /\/settings\/security/);
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

test('device transfer request still requires verified office location', () => {
  const source = fs.readFileSync(attendanceCheckInApiPath, 'utf8');

  assert.match(source, /const locationValidation = validateAttendanceLocation/);
  assert.match(source, /if \(!locationValidation\.ok\)/);
  assert.match(source, /locationValidation\.message/);
  assert.ok(source.indexOf('if (!locationValidation.ok)') < source.indexOf("if (action === 'request_device_transfer')"));
  assert.match(source, /body\?\.action === 'request_device_transfer'/);
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

  const sharedDeviceCheck = route.indexOf('reason: \'attendance-shared-device-block\'');
  assert.ok(sharedDeviceCheck > -1);
  assert.ok(sharedDeviceCheck < route.indexOf("if (action === 'request_device_transfer')"));
  assert.ok(sharedDeviceCheck < route.indexOf('async function syncTrustedDevice()'));
  assert.match(route, /return block\(\s*SHARED_ATTENDANCE_DEVICE_RESULT,\s*SHARED_ATTENDANCE_DEVICE_MESSAGE,\s*403/);
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
