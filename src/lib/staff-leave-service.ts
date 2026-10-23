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
import { formatPermissionDays } from '@/lib/staff-leave';

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
// matches by date range, not by ids read earlier, so one approved meanwhile is replaced too.
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
    .returning({
      date: attendancePermission.date,
      generalPardonType: attendancePermission.generalPardonType,
      id: attendancePermission.id,
      permissionType: attendancePermission.permissionType,
      reason: attendancePermission.reason,
    });
}

type ReplacedPermission = Awaited<ReturnType<typeof deletePermissionsCoveredByLeave>>[number];

// One audit event per replaced permission, written together; a failed audit write never undoes
// the saved leave or hides it from the admin.
export async function auditReplacedPermissions(input: {
  actor: { email: string; id: string | null };
  permissions: ReplacedPermission[];
  staffId: string;
  staffName?: string | null;
}) {
  await Promise.all(input.permissions.map((permission) => writeAuditEvent({
    action: 'DELETE',
    actor: input.actor,
    after: null,
    before: { ...permission, staffId: input.staffId, staffName: input.staffName ?? undefined },
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

// A deactivation (legacy staff_inactive_period row) touching the leave dates: the database won't
// accept leave over it, so say so plainly instead of failing.
export async function findInactivePeriodOverlap(input: {
  endDate: string;
  staffId: string;
  startDate: string;
}) {
  const result = await db.execute(sql`
    SELECT start_date::date::text AS start_date
    FROM staff_inactive_period
    WHERE staff_id = ${input.staffId}
      AND start_date::date <= ${input.endDate}::date
      AND (reactivated_on IS NULL OR reactivated_on::date > ${input.startDate}::date)
    LIMIT 1`);
  const row = (result.rows as Array<{ start_date: string }>)[0];
  return row ? { startDate: row.start_date } : null;
}
