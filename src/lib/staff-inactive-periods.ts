import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { staffInactivePeriod } from '@/db/schema';

export type StaffInactivePeriodRecord = typeof staffInactivePeriod.$inferSelect;

export function inactivePeriodCoversDate(
  period: Pick<StaffInactivePeriodRecord, 'startDate' | 'reactivatedOn'>,
  dateKey: string,
) {
  return period.startDate <= dateKey && (!period.reactivatedOn || dateKey < period.reactivatedOn);
}

export function isStaffActiveForDate(
  member: { active?: boolean | null; archived?: boolean | null; id: string },
  dateKey: string,
  periodsByStaffId: Map<string, Array<Pick<StaffInactivePeriodRecord, 'startDate' | 'reactivatedOn'>>>,
) {
  if (member.archived === true) return false;
  const periods = periodsByStaffId.get(member.id) || [];
  if (periods.some((period) => inactivePeriodCoversDate(period, dateKey))) return false;
  return periods.length > 0 || member.active !== false;
}

export function inactivePeriodMap(periods: Array<Pick<StaffInactivePeriodRecord, 'staffId' | 'startDate' | 'reactivatedOn'>>) {
  const map = new Map<string, Array<Pick<StaffInactivePeriodRecord, 'startDate' | 'reactivatedOn'>>>();
  for (const period of periods) {
    const rows = map.get(period.staffId) || [];
    rows.push(period);
    map.set(period.staffId, rows);
  }
  return map;
}

export async function getInactivePeriodsForDate(dateKey: string, staffIds?: string[]) {
  if (!staffInactivePeriod) return [];
  if (staffIds && staffIds.length === 0) return [];
  return db.select()
    .from(staffInactivePeriod)
    .where(and(
      lte(staffInactivePeriod.startDate, dateKey),
      or(isNull(staffInactivePeriod.reactivatedOn), gt(staffInactivePeriod.reactivatedOn, dateKey)),
      staffIds ? inArray(staffInactivePeriod.staffId, staffIds) : undefined,
    ))
    .orderBy(asc(staffInactivePeriod.startDate));
}

export async function getInactivePeriodsForRange(startDate: string, endDate: string, staffIds?: string[]) {
  if (!staffInactivePeriod) return [];
  if (staffIds && staffIds.length === 0) return [];
  return db.select()
    .from(staffInactivePeriod)
    .where(and(
      lte(staffInactivePeriod.startDate, endDate),
      or(isNull(staffInactivePeriod.reactivatedOn), gt(staffInactivePeriod.reactivatedOn, startDate)),
      staffIds ? inArray(staffInactivePeriod.staffId, staffIds) : undefined,
    ))
    .orderBy(asc(staffInactivePeriod.startDate));
}

export async function getAllInactivePeriods(staffIds?: string[]) {
  if (!staffInactivePeriod) return [];
  if (staffIds && staffIds.length === 0) return [];
  return db.select()
    .from(staffInactivePeriod)
    .where(staffIds ? inArray(staffInactivePeriod.staffId, staffIds) : undefined)
    .orderBy(asc(staffInactivePeriod.startDate));
}

export async function getOpenInactivePeriod(staffId: string) {
  if (!staffInactivePeriod) return null;
  const [period] = await db.select()
    .from(staffInactivePeriod)
    .where(and(eq(staffInactivePeriod.staffId, staffId), isNull(staffInactivePeriod.reactivatedOn)))
    .orderBy(asc(staffInactivePeriod.startDate))
    .limit(1);
  return period || null;
}

export function expandInactivePeriodsToPermissions(
  periods: StaffInactivePeriodRecord[],
  startDate: string,
  endDate: string,
) {
  const rows: Array<{
    arrivalWindow: 'full_day';
    date: string;
    expectedEndTime: null;
    expectedStartTime: null;
    permissionType: 'inactive';
    reason: string;
    staffId: string;
    status: 'approved';
  }> = [];

  for (const period of periods) {
    const effectiveStart = period.startDate < startDate ? startDate : period.startDate;
    let effectiveEnd = endDate;
    if (period.reactivatedOn && period.reactivatedOn <= endDate) {
      const date = new Date(`${period.reactivatedOn}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - 1);
      effectiveEnd = date.toISOString().slice(0, 10);
    }
    for (let current = effectiveStart; current <= effectiveEnd;) {
      rows.push({
        arrivalWindow: 'full_day',
        date: current,
        expectedEndTime: null,
        expectedStartTime: null,
        permissionType: 'inactive',
        reason: period.reasonCode,
        staffId: period.staffId,
        status: 'approved',
      });
      const next = new Date(`${current}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      current = next.toISOString().slice(0, 10);
    }
  }
  return rows;
}
