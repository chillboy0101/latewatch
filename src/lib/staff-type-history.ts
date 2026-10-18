import 'server-only';

import { and, asc, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { staffTypeChange } from '@/db/schema';
import type { StaffType, StaffTypeChange, StaffTypeOnDate } from '@/lib/staff-type';

// Each person's type changes, oldest first. People who never changed type have no rows.
export async function getStaffTypeChanges(staffIds: string[]) {
  const byStaffId = new Map<string, StaffTypeChange[]>();
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (ids.length === 0) return byStaffId;

  const rows = await db.select({
    effectiveFrom: staffTypeChange.effectiveFrom,
    staffId: staffTypeChange.staffId,
    staffType: staffTypeChange.staffType,
  })
    .from(staffTypeChange)
    .where(inArray(staffTypeChange.staffId, ids))
    .orderBy(asc(staffTypeChange.effectiveFrom), asc(staffTypeChange.createdAt));

  for (const row of rows) {
    const list = byStaffId.get(row.staffId) || [];
    list.push({ effectiveFrom: String(row.effectiveFrom).slice(0, 10), staffType: row.staffType });
    byStaffId.set(row.staffId, list);
  }
  return byStaffId;
}

// Days before someone's first change keep the type they had, from any date in the past.
const HISTORY_START = '2000-01-01';

export async function latestStaffTypeChangeDate(staffId: string) {
  const changes = (await getStaffTypeChanges([staffId])).get(staffId) || [];
  return changes.filter((change) => change.staffType !== 'away').at(-1)?.effectiveFrom ?? null;
}

// When their latest time away began (null if they were never away).
export async function latestAwayStart(staffId: string) {
  const changes = (await getStaffTypeChanges([staffId])).get(staffId) || [];
  return changes.filter((change) => change.staffType === 'away').at(-1)?.effectiveFrom ?? null;
}

// Saves a type (or 'away') from a date. The first change also keeps the earlier type for every
// day before it. An 'away' that hasn't started yet is dropped (brought back before leaving);
// one that has started is kept, since returns can't be dated before it.
export async function recordStaffTypeChange(input: {
  actorEmail?: string | null;
  effectiveFrom: string;
  previousType: StaffType;
  staffId: string;
  staffType: StaffTypeOnDate;
  today: string;
}) {
  const existing = (await getStaffTypeChanges([input.staffId])).get(input.staffId) || [];
  if (existing.length === 0) {
    await db.insert(staffTypeChange).values({
      createdByEmail: input.actorEmail || null,
      effectiveFrom: HISTORY_START,
      staffId: input.staffId,
      staffType: input.previousType,
    });
  }
  await db.delete(staffTypeChange).where(and(
    eq(staffTypeChange.staffId, input.staffId),
    or(
      eq(staffTypeChange.effectiveFrom, input.effectiveFrom),
      and(
        eq(staffTypeChange.staffType, 'away'),
        gte(staffTypeChange.effectiveFrom, input.effectiveFrom),
        gt(staffTypeChange.effectiveFrom, input.today),
      ),
    ),
  ));
  await db.insert(staffTypeChange).values({
    createdByEmail: input.actorEmail || null,
    effectiveFrom: input.effectiveFrom,
    staffId: input.staffId,
    staffType: input.staffType,
  });
}
