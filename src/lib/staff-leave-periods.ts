import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { staffLeavePeriod } from '@/db/schema';
import { formatLeavePermissionType, getInclusivePermissionDateRange } from '@/lib/attendance-permissions';

export type StaffLeavePeriodRecord = typeof staffLeavePeriod.$inferSelect;

export type LeavePermissionRecord = {
  approvedByEmail: string;
  approvedByUserId: null;
  arrivalWindow: 'full_day';
  createdAt: Date | null;
  date: string;
  endDate: string | null;
  expectedEndTime: null;
  expectedStartTime: null;
  id: string;
  leaveType: string;
  note: string | null;
  permissionType: 'leave';
  reason: string;
  staffId: string;
  startDate: string;
  status: 'approved';
  updatedAt: Date | null;
};

export function leavePeriodToPermission(period: StaffLeavePeriodRecord, date = period.startDate): LeavePermissionRecord {
  const leaveType = period.leaveType || 'other';
  return {
    approvedByEmail: period.updatedByEmail || period.createdByEmail || 'system',
    approvedByUserId: null,
    arrivalWindow: 'full_day',
    createdAt: period.createdAt || null,
    date,
    endDate: period.endDate || null,
    expectedEndTime: null,
    expectedStartTime: null,
    id: period.id,
    leaveType,
    note: period.note || null,
    permissionType: 'leave',
    reason: formatLeavePermissionType(leaveType),
    staffId: period.staffId,
    startDate: period.startDate,
    status: 'approved',
    updatedAt: period.updatedAt || null,
  };
}

export async function getLeavePeriodsForDate(dateKey: string, staffIds?: string[]) {
  // Some isolated unit tests provide a deliberately partial schema mock.
  if (!staffLeavePeriod) return [];
  if (staffIds && staffIds.length === 0) return [];

  return db.select()
    .from(staffLeavePeriod)
    .where(and(
      lte(staffLeavePeriod.startDate, dateKey),
      or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, dateKey)),
      staffIds ? inArray(staffLeavePeriod.staffId, staffIds) : undefined,
    ))
    .orderBy(asc(staffLeavePeriod.startDate));
}

export async function getLeavePeriodsForRange(startDate: string, endDate: string, staffIds?: string[]) {
  // Some isolated unit tests provide a deliberately partial schema mock.
  if (!staffLeavePeriod) return [];
  if (staffIds && staffIds.length === 0) return [];

  return db.select()
    .from(staffLeavePeriod)
    .where(and(
      lte(staffLeavePeriod.startDate, endDate),
      or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, startDate)),
      staffIds ? inArray(staffLeavePeriod.staffId, staffIds) : undefined,
    ))
    .orderBy(asc(staffLeavePeriod.startDate));
}

export async function getLeavePermissionForDate(staffId: string, dateKey: string) {
  // Some isolated unit tests provide a deliberately partial schema mock.
  if (!staffLeavePeriod) return null;
  const [period] = await db.select()
    .from(staffLeavePeriod)
    .where(and(
      eq(staffLeavePeriod.staffId, staffId),
      lte(staffLeavePeriod.startDate, dateKey),
      or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, dateKey)),
    ))
    .orderBy(asc(staffLeavePeriod.startDate))
    .limit(1);

  return period ? leavePeriodToPermission(period, dateKey) : null;
}

export function expandLeavePeriodsToPermissions(
  periods: StaffLeavePeriodRecord[],
  startDate: string,
  endDate: string,
) {
  return periods.flatMap((period) => {
    const effectiveStart = period.startDate < startDate ? startDate : period.startDate;
    const periodEnd = period.endDate || endDate;
    const effectiveEnd = periodEnd > endDate ? endDate : periodEnd;
    return getInclusivePermissionDateRange(effectiveStart, effectiveEnd)
      .map((date) => leavePeriodToPermission(period, date));
  });
}
