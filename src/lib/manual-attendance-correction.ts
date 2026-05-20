import { computePenalty } from '@/lib/penalty-calculator';
import { formatAbsencePermissionReason, getPermissionWindowBounds, isPermissionWindowActive } from '@/lib/attendance-permissions';
import { WORKDAY_START_TIME } from '@/lib/work-hours';

type AttendanceLike = {
  checkInAt: Date | string | null;
  checkInTime: string | null;
  computedAmount?: string | number | null;
  reason?: string | null;
  signOutAt?: Date | string | null;
  signOutTime?: string | null;
  status?: string | null;
};

type ManualAttendanceCorrection = {
  checkInAt: Date;
  checkInTime: string;
  computedAmount: string;
  reason: string | null;
  signOutAt?: Date | null;
  signOutTime?: string | null;
  status: 'excused' | 'late' | 'present';
};

type ManualPermissionLike = {
  arrivalWindow?: string | null;
  expectedEndTime?: string | null;
  expectedStartTime?: string | null;
  permissionType?: string | null;
  reason?: string | null;
  status?: string | null;
};

function normalizeTime(value: string | null | undefined) {
  const time = value?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function normalizeAmount(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function parseExistingDate(value: Date | string | null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function buildCheckInAt(date: string, time: string) {
  return new Date(`${date}T${time}:00.000Z`);
}

function buildSignOutAt(date: string, time: string) {
  return new Date(`${date}T${time}:00.000Z`);
}

function hasOwn(object: object, property: string) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function approvedLateArrivalReason(permission: ManualPermissionLike) {
  const window = getPermissionWindowBounds({
    arrivalWindow: permission.arrivalWindow || 'any_time_today',
    expectedEndTime: permission.expectedEndTime || null,
    expectedStartTime: permission.expectedStartTime || null,
    permissionType: 'late_arrival',
  });
  return `Approved late arrival (${window.label}): ${permission.reason || 'approved reason'}`.trim();
}

function approvedAbsenceReason(permission: ManualPermissionLike) {
  return `Excused absence: ${formatAbsencePermissionReason(permission.reason || 'approved reason')}`.trim();
}

export function resolveManualPenalty(input: {
  activePermission?: ManualPermissionLike | null;
  arrivalTime: string | null;
  didNotSignOut: boolean;
  isAttendanceOnly?: boolean;
  isNssPersonnel?: boolean;
}) {
  if (
    input.activePermission?.status === 'approved' &&
    input.activePermission.permissionType === 'absence'
  ) {
    return {
      amount: 0,
      didNotSignOut: false,
      reason: approvedAbsenceReason(input.activePermission),
      status: 'excused' as const,
    };
  }

  const permissionClearsLatePenalty = Boolean(
    input.activePermission?.status === 'approved' &&
    input.activePermission.permissionType === 'late_arrival' &&
    input.arrivalTime &&
    isPermissionWindowActive({
      arrivalWindow: input.activePermission.arrivalWindow || 'any_time_today',
      expectedEndTime: input.activePermission.expectedEndTime || null,
      expectedStartTime: input.activePermission.expectedStartTime || null,
      permissionType: 'late_arrival',
    }, input.arrivalTime),
  );

  if (permissionClearsLatePenalty && input.activePermission) {
    const signOutPenalty = input.didNotSignOut
      ? computePenalty({
          arrivalTime: null,
          didNotSignOut: true,
          isAttendanceOnly: input.isAttendanceOnly,
          isNssPersonnel: input.isNssPersonnel,
          isHoliday: false,
        })
      : { amount: 0, reason: '' };
    const permissionReason = approvedLateArrivalReason(input.activePermission);

    return {
      amount: signOutPenalty.amount,
      didNotSignOut: input.didNotSignOut,
      reason: signOutPenalty.amount > 0 ? `${signOutPenalty.reason}; ${permissionReason}` : permissionReason,
      status: signOutPenalty.amount > 0 ? 'late' as const : 'present' as const,
    };
  }

  const penalty = computePenalty({
    arrivalTime: input.arrivalTime,
    didNotSignOut: input.didNotSignOut,
    isAttendanceOnly: input.isAttendanceOnly,
    isNssPersonnel: input.isNssPersonnel,
    isHoliday: false,
  });

  return {
    amount: penalty.amount,
    didNotSignOut: input.didNotSignOut,
    reason: penalty.reason || null,
    status: penalty.amount > 0 ? 'late' as const : 'present' as const,
  };
}

export function resolveManualAttendanceCorrection(input: {
  activePermission?: ManualPermissionLike | null;
  attendance: AttendanceLike;
  arrivalTime: string | null;
  date: string;
  didNotSignOut: boolean;
  isAttendanceOnly?: boolean;
  isNssPersonnel?: boolean;
  signOutCorrection?: 'clear' | 'preserve' | 'set';
  signOutTime?: string | null;
}): ManualAttendanceCorrection {
  const currentArrivalTime = normalizeTime(input.attendance.checkInTime) || WORKDAY_START_TIME;
  const nextArrivalTime = input.arrivalTime || currentArrivalTime;
  const signOutCorrection = input.signOutCorrection || 'preserve';
  const nextPenalty = resolveManualPenalty({
    activePermission: input.activePermission,
    arrivalTime: nextArrivalTime,
    didNotSignOut: input.didNotSignOut,
    isAttendanceOnly: input.isAttendanceOnly,
    isNssPersonnel: input.isNssPersonnel,
  });
  const existingCheckInAt = parseExistingDate(input.attendance.checkInAt);
  const nextCheckInAt = input.arrivalTime
    ? buildCheckInAt(input.date, nextArrivalTime)
    : existingCheckInAt || buildCheckInAt(input.date, nextArrivalTime);
  const correction: ManualAttendanceCorrection = {
    checkInAt: nextCheckInAt,
    checkInTime: nextArrivalTime,
    computedAmount: nextPenalty.amount.toFixed(2),
    reason: nextPenalty.reason,
    status: nextPenalty.status,
  };

  if (signOutCorrection === 'clear') {
    correction.signOutAt = null;
    correction.signOutTime = null;
  } else if (signOutCorrection === 'set') {
    const nextSignOutTime = normalizeTime(input.signOutTime);
    if (nextSignOutTime) {
      correction.signOutAt = buildSignOutAt(input.date, nextSignOutTime);
      correction.signOutTime = nextSignOutTime;
    }
  }

  return correction;
}

export function manualAttendanceCorrectionChanged(input: {
  attendance: AttendanceLike;
  correction: ManualAttendanceCorrection;
}) {
  const existingCheckInAt = parseExistingDate(input.attendance.checkInAt);
  const nextCheckInAt = input.correction.checkInAt;
  const shouldCompareSignOutTime = hasOwn(input.correction, 'signOutTime');
  const shouldCompareSignOutAt = hasOwn(input.correction, 'signOutAt');
  const existingSignOutAt = parseExistingDate(input.attendance.signOutAt || null);
  const nextSignOutAt = input.correction.signOutAt;

  return (
    normalizeTime(input.attendance.checkInTime) !== input.correction.checkInTime ||
    normalizeAmount(input.attendance.computedAmount) !== input.correction.computedAmount ||
    (input.attendance.reason || null) !== input.correction.reason ||
    (input.attendance.status || null) !== input.correction.status ||
    (shouldCompareSignOutTime && normalizeTime(input.attendance.signOutTime) !== normalizeTime(input.correction.signOutTime)) ||
    (shouldCompareSignOutAt && (existingSignOutAt?.getTime() || null) !== (nextSignOutAt?.getTime() || null)) ||
    !existingCheckInAt ||
    existingCheckInAt.getTime() !== nextCheckInAt.getTime()
  );
}
