import { type AttendanceDayStatus, resolveManualPenalty } from '@/lib/manual-attendance-correction';
import {
  NO_SHOW_SIGN_IN_EFFECTIVE_DATE,
  NO_SHOW_SIGN_IN_REASON,
  NO_SHOW_SIGN_IN_WAIVED_REASON,
} from '@/lib/penalty-calculator';
import { shouldAlertNoSignOut } from '@/lib/work-hours';

type AttendanceRecordLike = {
  checkInTime: string | null;
  computedAmount: string | number | null;
  date: Date | string;
  id: string;
  noSignOutWaived?: boolean | null;
  noShowSignInWaived?: boolean | null;
  reason: string | null;
  signOutTime?: string | null;
  status: string;
};

type LatenessEntryLike = {
  arrivalTime: string | null;
  computedAmount: string | number | null;
  date: Date | string;
  didNotSignOut: boolean | null;
  id: string;
  reason: string | null;
  staffId: string;
};

type PermissionLike = {
  arrivalWindow?: string | null;
  date: Date | string;
  expectedEndTime?: string | null;
  expectedStartTime?: string | null;
  generalPardonType?: string | null;
  permissionType?: string | null;
  reason?: string | null;
  status?: string | null;
};

type PenaltyState = {
  amount: number;
  amountText: string;
  didNotSignOut: boolean;
  reason: string | null;
  status: AttendanceDayStatus;
};

export type StaffPenaltyRecalculationPlan = {
  attendanceUpdates: Array<{
    computedAmount: string;
    id: string;
    reason: string | null;
    status: AttendanceDayStatus;
  }>;
  latenessCreates: Array<{
    arrivalTime: string | null;
    computedAmount: string;
    date: string;
    didNotSignOut: boolean;
    reason: string;
    staffId: string;
  }>;
  latenessDeletes: Array<{ id: string }>;
  latenessUpdates: Array<{
    arrivalTime: string | null;
    computedAmount: string;
    didNotSignOut: boolean;
    id: string;
    reason: string;
  }>;
};

function normalizeDateKey(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function normalizeTime(value: string | null | undefined) {
  const time = value?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function amountText(value: number) {
  return value.toFixed(2);
}

function normalizeAmount(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amountText(amount) : '0.00';
}

function getCurrentAccraClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Africa/Accra',
    year: 'numeric',
  }).formatToParts(new Date());
  const valueFor = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  const hour = valueFor('hour') === '24' ? '00' : valueFor('hour');

  return {
    dateKey: `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`,
    timeKey: `${hour}:${valueFor('minute')}`,
  };
}

function shouldApplyNoSignOutPenalty(input: {
  checkInTime: string | null;
  currentDateKey: string;
  currentTimeKey: string;
  date: string;
  existingDidNotSignOut: boolean;
  noSignOutWaived: boolean;
  signOutKnown: boolean;
  signOutTime: string | null;
}) {
  if (!input.signOutKnown) return input.existingDidNotSignOut;
  if (input.noSignOutWaived) return false;
  if (!input.checkInTime || input.signOutTime) return false;
  if (input.existingDidNotSignOut) return true;
  if (input.date < input.currentDateKey) return true;
  if (input.date > input.currentDateKey) return false;
  return shouldAlertNoSignOut(input.currentTimeKey);
}

// Same rules as the sync and manual corrections, so changing a staff flag can't disagree with them.
function resolvePenaltyState(input: {
  arrivalTime: string | null;
  didNotSignOut: boolean;
  isAttendanceOnly: boolean;
  isNssPersonnel: boolean;
  noSignIn?: boolean;
  permission: PermissionLike | null;
}): PenaltyState {
  const penalty = resolveManualPenalty({
    activePermission: input.permission,
    arrivalTime: input.arrivalTime,
    didNotSignOut: input.didNotSignOut,
    isAttendanceOnly: input.isAttendanceOnly,
    isNssPersonnel: input.isNssPersonnel,
    noSignIn: input.noSignIn,
  });

  return {
    amount: penalty.amount,
    amountText: amountText(penalty.amount),
    didNotSignOut: penalty.didNotSignOut,
    reason: penalty.reason || null,
    status: penalty.status,
  };
}

function entryNeedsUpdate(entry: LatenessEntryLike, next: {
  arrivalTime: string | null;
  computedAmount: string;
  didNotSignOut: boolean;
  reason: string;
}) {
  return (
    normalizeTime(entry.arrivalTime) !== next.arrivalTime ||
    normalizeAmount(entry.computedAmount) !== next.computedAmount ||
    entry.didNotSignOut !== next.didNotSignOut ||
    (entry.reason || '') !== next.reason
  );
}

export function planStaffPenaltyRecalculation(input: {
  attendanceRecords: AttendanceRecordLike[];
  currentDateKey?: string;
  currentTimeKey?: string;
  isAttendanceOnly?: boolean;
  isNssPersonnel: boolean;
  latenessEntries: LatenessEntryLike[];
  /** Leave days: the sync clears those, so they are never recharged here. */
  leaveDates?: Set<string>;
  permissions: PermissionLike[];
  /** Paid or pardoned entries are settled and never rewritten or deleted. */
  protectedEntryIds?: Set<string>;
  staffId: string;
}): StaffPenaltyRecalculationPlan {
  const plan: StaffPenaltyRecalculationPlan = {
    attendanceUpdates: [],
    latenessCreates: [],
    latenessDeletes: [],
    latenessUpdates: [],
  };
  const entriesByDate = new Map<string, LatenessEntryLike[]>();
  for (const entry of input.latenessEntries) {
    const date = normalizeDateKey(entry.date);
    const entries = entriesByDate.get(date) || [];
    entries.push(entry);
    entriesByDate.set(date, entries);
  }
  const permissionsByDate = new Map(input.permissions.map((permission) => [normalizeDateKey(permission.date), permission]));
  const handledEntryIds = new Set<string>();
  const protectedEntryIds = input.protectedEntryIds || new Set<string>();
  const leaveDates = input.leaveDates || new Set<string>();
  const currentClock = input.currentDateKey && input.currentTimeKey
    ? { dateKey: input.currentDateKey, timeKey: input.currentTimeKey }
    : getCurrentAccraClock();

  for (const attendance of input.attendanceRecords) {
    const date = normalizeDateKey(attendance.date);
    const existingEntries = entriesByDate.get(date) || [];
    const existingEntry = existingEntries[0] || null;
    if (leaveDates.has(date) || existingEntries.some((entry) => protectedEntryIds.has(entry.id))) {
      for (const entry of existingEntries) handledEntryIds.add(entry.id);
      continue;
    }
    const arrivalTime = normalizeTime(attendance.checkInTime);
    const noSignIn = date >= NO_SHOW_SIGN_IN_EFFECTIVE_DATE && !arrivalTime && (
      attendance.noShowSignInWaived === true ||
      attendance.reason === NO_SHOW_SIGN_IN_REASON ||
      attendance.reason === NO_SHOW_SIGN_IN_WAIVED_REASON ||
      attendance.status === 'absent'
    );
    const didNotSignOut = shouldApplyNoSignOutPenalty({
      checkInTime: arrivalTime,
      currentDateKey: currentClock.dateKey,
      currentTimeKey: currentClock.timeKey,
      date,
      existingDidNotSignOut: existingEntry?.didNotSignOut === true,
      noSignOutWaived: attendance.noSignOutWaived === true,
      signOutKnown: 'signOutTime' in attendance,
      signOutTime: normalizeTime(attendance.signOutTime),
    });
    const next = resolvePenaltyState({
      arrivalTime,
      didNotSignOut,
      isAttendanceOnly: input.isAttendanceOnly === true,
      isNssPersonnel: input.isNssPersonnel,
      noSignIn,
      permission: permissionsByDate.get(date) || null,
    });

    if (noSignIn && attendance.noShowSignInWaived === true) {
      for (const existingEntryForDate of existingEntries) {
        handledEntryIds.add(existingEntryForDate.id);
        if (existingEntryForDate.reason === NO_SHOW_SIGN_IN_REASON) {
          plan.latenessUpdates.push({
            arrivalTime: null,
            computedAmount: '0.00',
            didNotSignOut: false,
            id: existingEntryForDate.id,
            reason: NO_SHOW_SIGN_IN_WAIVED_REASON,
          });
        }
      }
      continue;
    }

    if (
      normalizeAmount(attendance.computedAmount) !== next.amountText ||
      (attendance.reason || null) !== next.reason ||
      attendance.status !== next.status
    ) {
      plan.attendanceUpdates.push({
        computedAmount: next.amountText,
        id: attendance.id,
        reason: next.reason,
        status: next.status,
      });
    }

    for (const existingEntryForDate of existingEntries) {
      handledEntryIds.add(existingEntryForDate.id);
    }

    if (next.amount > 0) {
      const entryValues = {
        arrivalTime,
        computedAmount: next.amountText,
        didNotSignOut,
        reason: next.reason || '',
      };

      if (existingEntry) {
        if (entryNeedsUpdate(existingEntry, entryValues)) {
          plan.latenessUpdates.push({
            id: existingEntry.id,
            ...entryValues,
          });
        }
        for (const duplicateEntry of existingEntries.slice(1)) {
          plan.latenessDeletes.push({ id: duplicateEntry.id });
        }
      } else {
        plan.latenessCreates.push({
          ...entryValues,
          date,
          staffId: input.staffId,
        });
      }
    } else if (existingEntry) {
      for (const entryToDelete of existingEntries) {
        plan.latenessDeletes.push({ id: entryToDelete.id });
      }
    }
  }

  for (const entry of input.latenessEntries) {
    if (handledEntryIds.has(entry.id) || protectedEntryIds.has(entry.id)) continue;

    const date = normalizeDateKey(entry.date);
    if (leaveDates.has(date)) continue;
    const next = resolvePenaltyState({
      arrivalTime: normalizeTime(entry.arrivalTime),
      didNotSignOut: entry.didNotSignOut === true,
      isAttendanceOnly: input.isAttendanceOnly === true,
      isNssPersonnel: input.isNssPersonnel,
      noSignIn: entry.reason === NO_SHOW_SIGN_IN_REASON,
      permission: permissionsByDate.get(date) || null,
    });

    if (next.amount > 0) {
      const entryValues = {
        arrivalTime: normalizeTime(entry.arrivalTime),
        computedAmount: next.amountText,
        didNotSignOut: next.didNotSignOut,
        reason: next.reason || '',
      };

      if (entryNeedsUpdate(entry, entryValues)) {
        plan.latenessUpdates.push({
          id: entry.id,
          ...entryValues,
        });
      }
    } else {
      plan.latenessDeletes.push({ id: entry.id });
    }
  }

  return plan;
}
