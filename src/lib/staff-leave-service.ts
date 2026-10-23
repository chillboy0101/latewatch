import 'server-only';

import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  attendancePermission,
  latenessDebtPardonEntry,
  latenessEntry,
  latenessPaymentAllocation,
  staffLeavePeriod,
} from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { formatPermissionDays, isStaffLeaveDate } from '@/lib/staff-leave';

export async function getStaffLeavePeriodsForRange(input: {
  endDate: string;
  staffIds?: string[];
  startDate: string;
}) {
  if (input.staffIds?.length === 0) return [];

  return db.select({
    endDate: staffLeavePeriod.endDate,
    id: staffLeavePeriod.id,
    leaveType: staffLeavePeriod.leaveType,
    returnedOn: staffLeavePeriod.returnedOn,
    source: staffLeavePeriod.source,
    staffId: staffLeavePeriod.staffId,
    startDate: staffLeavePeriod.startDate,
  })
    .from(staffLeavePeriod)
    .where(and(
      ne(staffLeavePeriod.source, 'staff_status'),
      lte(staffLeavePeriod.startDate, input.endDate),
      sql`COALESCE(${staffLeavePeriod.returnedOn} - 1, ${staffLeavePeriod.endDate}, 'infinity'::date) >= ${input.startDate}::date`,
      ...(input.staffIds ? [inArray(staffLeavePeriod.staffId, input.staffIds)] : []),
    ));
}

export async function findOverlappingStaffLeavePeriod(input: {
  endDate: string;
  excludeId?: string;
  staffId: string;
  startDate: string;
}) {
  const [period] = await db.select({
    endDate: staffLeavePeriod.endDate,
    id: staffLeavePeriod.id,
    leaveType: staffLeavePeriod.leaveType,
    returnedOn: staffLeavePeriod.returnedOn,
    source: staffLeavePeriod.source,
    startDate: staffLeavePeriod.startDate,
  })
    .from(staffLeavePeriod)
    .where(and(
      eq(staffLeavePeriod.staffId, input.staffId),
      ne(staffLeavePeriod.source, 'staff_status'),
      ...(input.excludeId ? [ne(staffLeavePeriod.id, input.excludeId)] : []),
      lte(staffLeavePeriod.startDate, input.endDate),
      sql`COALESCE(${staffLeavePeriod.returnedOn} - 1, ${staffLeavePeriod.endDate}, 'infinity'::date) >= ${input.startDate}::date`,
    ))
    .limit(1);

  return period || null;
}

export async function getLeaveFinancialReview(input: {
  endDate: string;
  staffId: string;
  startDate: string;
}) {
  const entries = await db.select({
    amount: latenessEntry.computedAmount,
    id: latenessEntry.id,
  })
    .from(latenessEntry)
    .where(and(
      eq(latenessEntry.staffId, input.staffId),
      gte(latenessEntry.date, input.startDate),
      lte(latenessEntry.date, input.endDate),
    ));
  const entryIds = entries.map((entry) => entry.id);
  if (entryIds.length === 0) {
    return { pardonedEntryCount: 0, protectedAmount: '0.00', protectedEntryCount: 0, paidEntryCount: 0 };
  }

  const [allocations, pardons] = await Promise.all([
    db.select({ entryId: latenessPaymentAllocation.entryId })
      .from(latenessPaymentAllocation)
      .where(inArray(latenessPaymentAllocation.entryId, entryIds)),
    db.select({ entryId: latenessDebtPardonEntry.entryId })
      .from(latenessDebtPardonEntry)
      .where(inArray(latenessDebtPardonEntry.entryId, entryIds)),
  ]);
  const paidEntryIds = new Set(allocations.map((row) => row.entryId));
  const pardonedEntryIds = new Set(pardons.map((row) => row.entryId));
  const protectedIds = new Set([...paidEntryIds, ...pardonedEntryIds]);
  const protectedAmount = entries
    .filter((entry) => protectedIds.has(entry.id) && Number(entry.amount || 0) > 0)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  return {
    pardonedEntryCount: pardonedEntryIds.size,
    protectedAmount: protectedAmount.toFixed(2),
    protectedEntryCount: protectedIds.size,
    paidEntryCount: paidEntryIds.size,
  };
}

export async function hasFinanciallyProtectedLeaveRows(input: {
  endDate: string;
  staffId: string;
  startDate: string;
}) {
  const review = await getLeaveFinancialReview(input);
  return review.protectedEntryCount > 0;
}

export async function getFinanciallyProtectedLeaveEntryIds(entryIds: string[]) {
  if (entryIds.length === 0) return new Set<string>();

  const [allocations, pardons] = await Promise.all([
    getFinanciallyAllocatedEntryIds(entryIds),
    getPardonedEntryIds(entryIds),
  ]);

  return new Set([...allocations, ...pardons]);
}

export async function getFinanciallyAllocatedEntryIds(entryIds: string[]) {
  if (entryIds.length === 0) return new Set<string>();

  const allocations = await db.select({ entryId: latenessPaymentAllocation.entryId })
    .from(latenessPaymentAllocation)
    .where(inArray(latenessPaymentAllocation.entryId, entryIds));

  return new Set(allocations.map((row) => row.entryId));
}

export async function getPardonedEntryIds(entryIds: string[]) {
  if (entryIds.length === 0) return new Set<string>();

  const pardons = await db.select({ entryId: latenessDebtPardonEntry.entryId })
    .from(latenessDebtPardonEntry)
    .where(inArray(latenessDebtPardonEntry.entryId, entryIds));

  return new Set(pardons.map((row) => row.entryId));
}
// Approved absence / late-arrival permissions (general pardons too) on the leave's days. Leave
// takes those days over, so they are deleted in the same db.batch as the leave save. The delete
// matches by date range, not by ids read earlier, so one approved meanwhile is replaced too. The
// whole row comes back so it can be restored if the leave is later removed or shortened.
export function deletePermissionsCoveredByLeave(input: {
  endDate: string;
  staffId: string;
  startDate: string;
}) {
  return db.delete(attendancePermission)
    .where(and(
      eq(attendancePermission.staffId, input.staffId),
      eq(attendancePermission.status, 'approved'),
      gte(attendancePermission.date, input.startDate),
      lte(attendancePermission.date, input.endDate),
    ))
    .returning();
}

type ReplacedPermission = typeof attendancePermission.$inferSelect;

// One audit event per replaced permission (tagged with the leave that replaced it), written
// together; a failed audit write never undoes the saved leave or hides it from the admin.
export async function auditReplacedPermissions(input: {
  actor: { email: string; id: string | null };
  leaveId: string;
  permissions: ReplacedPermission[];
  staffName?: string | null;
}) {
  await Promise.all(input.permissions.map((permission) => writeAuditEvent({
    action: 'DELETE',
    actor: input.actor,
    after: null,
    before: { ...permission, replacedByLeaveId: input.leaveId, staffName: input.staffName ?? undefined },
    entityId: permission.id,
    entityType: 'attendance_permission',
    publish: false,
    reason: 'replaced-by-leave',
  }).catch((error) => console.error('Failed to audit permission replaced by leave:', error))));
}

export function replacedPermissionSummary(permissions: ReplacedPermission[]) {
  const dates = permissions.map((permission) => String(permission.date).slice(0, 10)).sort();
  return { replacedPermissionCount: dates.length, replacedPermissionDays: formatPermissionDays(dates) };
}

// A leave removed or shortened gives back the permissions it replaced on days it no longer
// covers (unless that day has another permission, leave or deactivation by now). Run it after the
// leave change is saved and before the days are recalculated.
export async function restorePermissionsReplacedByLeave(input: {
  actor: { email: string; id: string | null };
  keep?: { endDate: string; startDate: string } | null;
  leaveId: string;
  staffId: string;
}) {
  const result = await db.execute(sql`
    SELECT before_json AS permission
    FROM audit_event
    WHERE entity_type = 'attendance_permission'
      AND reason = 'replaced-by-leave'
      AND before_json->>'replacedByLeaveId' = ${input.leaveId}`);
  const replaced = (result.rows as Array<{ permission: Record<string, unknown> }>)
    .map((row) => row.permission)
    .filter((permission) => {
      const date = String(permission.date || '').slice(0, 10);
      return date && (!input.keep || date < input.keep.startDate || date > input.keep.endDate);
    });
  if (replaced.length === 0) return [];

  const dates = replaced.map((permission) => String(permission.date).slice(0, 10)).sort();
  const coverage = await getLeaveAndDeactivationCoverage({ endDate: dates[dates.length - 1], staffIds: [input.staffId], startDate: dates[0] });
  const restored: string[] = [];
  for (const permission of replaced) {
    const date = String(permission.date).slice(0, 10);
    if (coverage(input.staffId, date)) continue;
    const [row] = await db.insert(attendancePermission)
      .values({
        approvedByEmail: String(permission.approvedByEmail || input.actor.email),
        approvedByUserId: (permission.approvedByUserId as string | null) ?? null,
        arrivalWindow: String(permission.arrivalWindow || 'full_day'),
        date,
        expectedEndTime: (permission.expectedEndTime as string | null) ?? null,
        expectedStartTime: (permission.expectedStartTime as string | null) ?? null,
        generalPardonType: (permission.generalPardonType as string | null) ?? null,
        id: String(permission.id),
        permissionType: String(permission.permissionType || 'absence'),
        reason: String(permission.reason || 'restored'),
        staffId: input.staffId,
        status: 'approved',
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    restored.push(date);
    await writeAuditEvent({
      action: 'CREATE',
      actor: input.actor,
      after: { ...row, restoredFromLeaveId: input.leaveId },
      before: null,
      entityId: row.id,
      entityType: 'attendance_permission',
      publish: false,
      reason: 'restored-after-leave-change',
    }).catch((error) => console.error('Failed to audit restored permission:', error));
  }
  return restored.sort();
}

async function getInactivePeriods(input: { endDate: string; staffIds: string[]; startDate: string }) {
  if (input.staffIds.length === 0) return [];
  const result = await db.execute(sql`
    SELECT staff_id::text AS staff_id, start_date::date::text AS start_date, reactivated_on::date::text AS reactivated_on
    FROM staff_inactive_period
    WHERE staff_id IN (${sql.join(input.staffIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND start_date::date <= ${input.endDate}::date
      AND (reactivated_on IS NULL OR reactivated_on::date > ${input.startDate}::date)
    ORDER BY start_date`);
  return result.rows as Array<{ reactivated_on: string | null; staff_id: string; start_date: string }>;
}

// A deactivation (legacy staff_inactive_period row) touching the leave dates: the database won't
// accept leave over it, so say so plainly instead of failing.
export async function findInactivePeriodOverlap(input: {
  endDate: string;
  staffId: string;
  startDate: string;
}) {
  const [row] = await getInactivePeriods({ endDate: input.endDate, staffIds: [input.staffId], startDate: input.startDate });
  return row ? { startDate: row.start_date } : null;
}

export type DayCoverage = 'leave' | 'deactivated' | null;

// Which days already have leave or a deactivation for these staff. A permission can't be stored
// on those days (the database keeps one excuse per day), and none is needed: leave already
// excuses the day, and a deactivated person isn't charged.
export async function getLeaveAndDeactivationCoverage(input: {
  endDate: string;
  staffIds: string[];
  startDate: string;
}) {
  if (input.staffIds.length === 0) return (): DayCoverage => null;
  const [periods, inactive] = await Promise.all([
    getStaffLeavePeriodsForRange(input),
    getInactivePeriods(input),
  ]);
  return (staffId: string, date: string): DayCoverage => {
    if (isStaffLeaveDate(periods, staffId, date)) return 'leave';
    const deactivated = inactive.some((row) => row.staff_id === staffId
      && row.start_date <= date && (!row.reactivated_on || date < row.reactivated_on));
    return deactivated ? 'deactivated' : null;
  };
}
