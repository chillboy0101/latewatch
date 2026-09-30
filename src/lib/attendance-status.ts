export type AttendanceStatus = 'present' | 'late' | 'excused' | 'expected_late' | 'permission_overdue' | 'no_sign_out' | 'not_checked_in' | 'on_leave';

const ATTENDANCE_STATUSES = new Set<AttendanceStatus>([
  'present',
  'late',
  'excused',
  'expected_late',
  'permission_overdue',
  'no_sign_out',
  'not_checked_in',
  'on_leave',
]);

function isAttendanceStatus(value: string | null | undefined): value is AttendanceStatus {
  return ATTENDANCE_STATUSES.has(value as AttendanceStatus);
}

function uniqueStatuses(statuses: AttendanceStatus[]) {
  return Array.from(new Set(statuses));
}

export function getAttendanceStatusFlags({
  absencePermission,
  attendanceStatus,
  fallbackStatus,
  hasAttendance,
  noSignOut,
  onLeave = false,
}: {
  absencePermission: boolean;
  attendanceStatus?: string | null;
  fallbackStatus: AttendanceStatus;
  hasAttendance: boolean;
  noSignOut: boolean;
  onLeave?: boolean;
}) {
  if (absencePermission) {
    return onLeave ? ['excused', 'on_leave'] satisfies AttendanceStatus[] : ['excused'] satisfies AttendanceStatus[];
  }

  const statuses: AttendanceStatus[] = [];
  if (hasAttendance && isAttendanceStatus(attendanceStatus)) {
    statuses.push(attendanceStatus);
  } else {
    statuses.push(onLeave ? 'on_leave' : fallbackStatus);
  }

  if (noSignOut && !onLeave) statuses.push('no_sign_out');
  if (onLeave && hasAttendance && !statuses.includes('on_leave')) statuses.push('on_leave');
  return uniqueStatuses(statuses);
}

export function primaryAttendanceStatus(statuses: AttendanceStatus[]) {
  return statuses[0] || 'not_checked_in';
}
