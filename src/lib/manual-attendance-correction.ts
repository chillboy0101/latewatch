import { computePenalty } from '@/lib/penalty-calculator';
import { WORKDAY_START_TIME } from '@/lib/work-hours';

type AttendanceLike = {
  checkInAt: Date | string | null;
  checkInTime: string | null;
  computedAmount?: string | number | null;
  reason?: string | null;
  status?: string | null;
};

type ManualAttendanceCorrection = {
  checkInAt: Date;
  checkInTime: string;
  computedAmount: string;
  reason: string | null;
  status: 'late' | 'present';
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

export function resolveManualAttendanceCorrection(input: {
  attendance: AttendanceLike;
  arrivalTime: string | null;
  date: string;
  didNotSignOut: boolean;
}): ManualAttendanceCorrection {
  const currentArrivalTime = normalizeTime(input.attendance.checkInTime) || WORKDAY_START_TIME;
  const nextArrivalTime = input.arrivalTime || currentArrivalTime;
  const nextPenalty = computePenalty({
    arrivalTime: nextArrivalTime,
    didNotSignOut: input.didNotSignOut,
    isHoliday: false,
  });
  const existingCheckInAt = parseExistingDate(input.attendance.checkInAt);
  const nextCheckInAt = input.arrivalTime
    ? buildCheckInAt(input.date, nextArrivalTime)
    : existingCheckInAt || buildCheckInAt(input.date, nextArrivalTime);

  return {
    checkInAt: nextCheckInAt,
    checkInTime: nextArrivalTime,
    computedAmount: nextPenalty.amount.toFixed(2),
    reason: nextPenalty.reason || null,
    status: nextPenalty.amount > 0 ? 'late' : 'present',
  };
}

export function manualAttendanceCorrectionChanged(input: {
  attendance: AttendanceLike;
  correction: ManualAttendanceCorrection;
}) {
  const existingCheckInAt = parseExistingDate(input.attendance.checkInAt);
  const nextCheckInAt = input.correction.checkInAt;

  return (
    normalizeTime(input.attendance.checkInTime) !== input.correction.checkInTime ||
    normalizeAmount(input.attendance.computedAmount) !== input.correction.computedAmount ||
    (input.attendance.reason || null) !== input.correction.reason ||
    (input.attendance.status || null) !== input.correction.status ||
    !existingCheckInAt ||
    existingCheckInAt.getTime() !== nextCheckInAt.getTime()
  );
}
