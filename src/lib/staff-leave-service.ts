import 'server-only';

import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  latenessDebtPardonEntry,
  latenessEntry,
  latenessPaymentAllocation,
  staffLeavePeriod,
} from '@/db/schema';

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