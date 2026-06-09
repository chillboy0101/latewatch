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
const generalPardonApiPath = path.join(__dirname, '../src/app/api/attendance/permissions/general-pardon/route.ts');
const reconciliationPath = path.join(__dirname, '../src/lib/attendance-permission-reconciliation.ts');
const attendanceDeviceSecurityLibPath = path.join(__dirname, '../src/lib/attendance-device-security.ts');
const clerkSessionRevocationLibPath = path.join(__dirname, '../src/lib/clerk-session-revocation.ts');
const pushSubscriptionsLibPath = path.join(__dirname, '../src/lib/push-subscriptions.ts');

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

test('device transfer approval revokes staff Clerk sessions but rejection does not', () => {
  const route = fs.readFileSync(deviceTransferRoutePath, 'utf8');

  assert.match(route, /revokeStaffLoginSessions\(\{\s*deviceUserId: beforeDevice\?\.userId,\s*staffEmail: member\?\.email/);
  assert.match(route, /let revokedSessions = 0/);
  assert.match(route, /let sessionRevocation: StaffSessionRevocationResult \| null = null/);
  assert.match(route, /revokedSessions/);
  assert.match(route, /sessionRevocation/);
  assert.match(route, /SESSION_REVOCATION_FAILED/);
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('const deviceValues = {'));
  assert.ok(route.indexOf('revokeStaffLoginSessions({') < route.indexOf('await db.insert(staffDevice)'));
  assert.doesNotMatch(route, /action === 'reject'[\s\S]{0,400}revokeStaffLoginSessions/);
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
