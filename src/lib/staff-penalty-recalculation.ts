import { getPermissionWindowBounds, isPermissionWindowActive } from '@/lib/attendance-permissions';
import { computePenalty } from '@/lib/penalty-calculator';

type AttendanceRecordLike = {
  checkInTime: string | null;
  computedAmount: string | number | null;
  date: Date | string;
  id: string;
  reason: string | null;
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
  permissionType?: string | null;
  reason?: string | null;
  status?: string | null;
};

type PenaltyState = {
  amount: number;
  amountText: string;
  didNotSignOut: boolean;
  reason: string | null;
  status: 'late' | 'present';
};

export type StaffPenaltyRecalculationPlan = {
  attendanceUpdates: Array<{
    computedAmount: string;
    id: string;
    reason: string | null;
    status: 'late' | 'present';
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

function approvedLateArrivalReason(permission: PermissionLike) {
  const window = getPermissionWindowBounds(permission);
  return `Approved late arrival (${window.label}): ${permission.reason || ''}`.trim();
}

function resolvePenaltyState(input: {
  arrivalTime: string | null;
  didNotSignOut: boolean;
  isAttendanceOnly: boolean;
  isNssPersonnel: boolean;
  permission: PermissionLike | null;
}): PenaltyState {
  const permissionClearsLatePenalty = Boolean(
    input.permission?.status === 'approved' &&
    input.permission.permissionType === 'late_arrival' &&
    input.arrivalTime &&
    isPermissionWindowActive(input.permission, input.arrivalTime),
  );

  if (permissionClearsLatePenalty && input.permission) {
    const signOutPenalty = input.didNotSignOut
      ? computePenalty({
          arrivalTime: null,
          didNotSignOut: true,
          isAttendanceOnly: input.isAttendanceOnly,
          isNssPersonnel: input.isNssPersonnel,
          isHoliday: false,
        })
      : { amount: 0, reason: '' };
    const reason = signOutPenalty.amount > 0
      ? `${signOutPenalty.reason}; ${approvedLateArrivalReason(input.permission)}`
      : approvedLateArrivalReason(input.permission);

    return {
      amount: signOutPenalty.amount,
      amountText: amountText(signOutPenalty.amount),
      didNotSignOut: input.didNotSignOut,
      reason,
      status: signOutPenalty.amount > 0 ? 'late' : 'present',
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
    amountText: amountText(penalty.amount),
    didNotSignOut: input.didNotSignOut,
    reason: penalty.reason || null,
    status: penalty.amount > 0 ? 'late' : 'present',
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
  isAttendanceOnly?: boolean;
  isNssPersonnel: boolean;
  latenessEntries: LatenessEntryLike[];
  permissions: PermissionLike[];
  staffId: string;
}): StaffPenaltyRecalculationPlan {
  const plan: StaffPenaltyRecalculationPlan = {
    attendanceUpdates: [],
    latenessCreates: [],
    latenessDeletes: [],
    latenessUpdates: [],
  };
  const entriesByDate = new Map(input.latenessEntries.map((entry) => [normalizeDateKey(entry.date), entry]));
  const permissionsByDate = new Map(input.permissions.map((permission) => [normalizeDateKey(permission.date), permission]));
  const handledEntryIds = new Set<string>();

  for (const attendance of input.attendanceRecords) {
    const date = normalizeDateKey(attendance.date);
    const existingEntry = entriesByDate.get(date) || null;
    const didNotSignOut = existingEntry?.didNotSignOut === true;
    const arrivalTime = normalizeTime(attendance.checkInTime);
    const next = resolvePenaltyState({
      arrivalTime,
      didNotSignOut,
      isAttendanceOnly: input.isAttendanceOnly === true,
      isNssPersonnel: input.isNssPersonnel,
      permission: permissionsByDate.get(date) || null,
    });

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

    if (existingEntry) {
      handledEntryIds.add(existingEntry.id);
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
      } else {
        plan.latenessCreates.push({
          ...entryValues,
          date,
          staffId: input.staffId,
        });
      }
    } else if (existingEntry) {
      plan.latenessDeletes.push({ id: existingEntry.id });
    }
  }

  for (const entry of input.latenessEntries) {
    if (handledEntryIds.has(entry.id)) continue;

    const date = normalizeDateKey(entry.date);
    const next = resolvePenaltyState({
      arrivalTime: normalizeTime(entry.arrivalTime),
      didNotSignOut: entry.didNotSignOut === true,
      isAttendanceOnly: input.isAttendanceOnly === true,
      isNssPersonnel: input.isNssPersonnel,
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
