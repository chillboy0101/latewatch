export type AttendanceStatus = 'present' | 'late' | 'excused' | 'on_leave' | 'expected_late' | 'permission_overdue' | 'no_sign_out' | 'not_checked_in';

const ATTENDANCE_STATUSES = new Set<AttendanceStatus>([
  'present',
  'late',
  'excused',
  'on_leave',
  'expected_late',
  'permission_overdue',
  'no_sign_out',
  'not_checked_in',
]);

function isAttendanceStatus(value: string | null | undefined): value is AttendanceStatus {
  return ATTENDANCE_STATUSES.has(value as AttendanceStatus);
}

function uniqueStatuses(statuses: AttendanceStatus[]) {
  return Array.from(new Set(statuses));
}

export function getAttendanceStatusFlags({
  absencePermission,
  leavePermission = false,
  attendanceStatus,
  fallbackStatus,
  hasAttendance,
  noSignOut,
}: {
  absencePermission: boolean;
  leavePermission?: boolean;
  attendanceStatus?: string | null;
  fallbackStatus: AttendanceStatus;
  hasAttendance: boolean;
  noSignOut: boolean;
}) {
  if (leavePermission) return ['on_leave'] satisfies AttendanceStatus[];
  if (absencePermission) return ['excused'] satisfies AttendanceStatus[];

  const statuses: AttendanceStatus[] = [];
  if (hasAttendance && isAttendanceStatus(attendanceStatus)) {
    statuses.push(attendanceStatus);
  } else {
    statuses.push(fallbackStatus);
  }

  if (noSignOut) statuses.push('no_sign_out');
  return uniqueStatuses(statuses);
}

export function primaryAttendanceStatus(statuses: AttendanceStatus[]) {
  return statuses[0] || 'not_checked_in';
}
