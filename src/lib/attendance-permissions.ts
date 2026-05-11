import { WORKDAY_END_TIME, WORKDAY_START_TIME } from '@/lib/work-hours';

export const ATTENDANCE_PERMISSION_WINDOWS = [
  { value: 'any_time_today', label: 'Any time today' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'specific_time', label: 'Specific time' },
] as const;

export const LATE_ARRIVAL_PERMISSION_REASONS = [
  { value: 'training', label: 'Training' },
  { value: 'official duty', label: 'Official duty' },
  { value: 'personal excuse', label: 'Personal excuse' },
] as const;

export type AttendancePermissionWindow = typeof ATTENDANCE_PERMISSION_WINDOWS[number]['value'];
export type LateArrivalPermissionReason = typeof LATE_ARRIVAL_PERMISSION_REASONS[number]['value'];

export type AttendancePermissionLike = {
  arrivalWindow?: string | null;
  expectedEndTime?: string | null;
  expectedStartTime?: string | null;
  permissionType?: string | null;
};

const VALID_WINDOWS = new Set<string>(ATTENDANCE_PERMISSION_WINDOWS.map((option) => option.value));
const VALID_LATE_ARRIVAL_REASONS = new Set<string>(LATE_ARRIVAL_PERMISSION_REASONS.map((option) => option.value));
const MINUTE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizePermissionWindow(value: unknown): AttendancePermissionWindow {
  return typeof value === 'string' && VALID_WINDOWS.has(value)
    ? value as AttendancePermissionWindow
    : 'any_time_today';
}

export function normalizeMinuteTime(value: unknown) {
  if (typeof value !== 'string') return null;
  const time = value.trim().slice(0, 5);
  return MINUTE_TIME_PATTERN.test(time) ? time : null;
}

export function normalizeLateArrivalPermissionReason(value: unknown): LateArrivalPermissionReason | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim().toLowerCase();
  return VALID_LATE_ARRIVAL_REASONS.has(reason) ? reason as LateArrivalPermissionReason : null;
}

export function isValidLateArrivalPermissionReason(value: unknown) {
  return normalizeLateArrivalPermissionReason(value) !== null;
}

export function formatLateArrivalPermissionReason(value: string | null | undefined) {
  const reason = normalizeLateArrivalPermissionReason(value);
  if (!reason) return value || '';

  return LATE_ARRIVAL_PERMISSION_REASONS.find((option) => option.value === reason)?.label || reason;
}

export function formatTimeLabel(value: string | null | undefined) {
  const time = normalizeMinuteTime(value);
  if (!time) return '';

  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

export function getPermissionWindowBounds(permission: AttendancePermissionLike | null | undefined) {
  if (!permission || permission.permissionType === 'absence') {
    return {
      endTime: null,
      label: 'Excused absence',
      startTime: null,
    };
  }

  const arrivalWindow = normalizePermissionWindow(permission.arrivalWindow);

  if (arrivalWindow === 'morning') {
    return {
      endTime: '12:00',
      label: 'Morning',
      startTime: WORKDAY_START_TIME,
    };
  }

  if (arrivalWindow === 'afternoon') {
    return {
      endTime: WORKDAY_END_TIME,
      label: 'Afternoon',
      startTime: '12:00',
    };
  }

  if (arrivalWindow === 'specific_time') {
    const endTime = normalizeMinuteTime(permission.expectedEndTime) || WORKDAY_END_TIME;
    return {
      endTime,
      label: `By ${formatTimeLabel(endTime)}`,
      startTime: WORKDAY_START_TIME,
    };
  }

  return {
    endTime: WORKDAY_END_TIME,
    label: 'Any time today',
    startTime: WORKDAY_START_TIME,
  };
}

export function isPermissionWindowActive(permission: AttendancePermissionLike | null | undefined, currentTime: string) {
  if (!permission || permission.permissionType !== 'late_arrival') return false;
  const { endTime } = getPermissionWindowBounds(permission);
  const time = normalizeMinuteTime(currentTime);
  return Boolean(endTime && time && time <= endTime);
}

export function isPermissionWindowOverdue(
  permission: AttendancePermissionLike | null | undefined,
  permissionDate: string,
  currentDate: string,
  currentTime: string,
) {
  if (!permission || permission.permissionType !== 'late_arrival') return false;
  if (currentDate > permissionDate) return true;
  if (currentDate < permissionDate) return false;

  const { endTime } = getPermissionWindowBounds(permission);
  const time = normalizeMinuteTime(currentTime);
  return Boolean(endTime && time && time > endTime);
}
