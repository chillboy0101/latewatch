import 'server-only';

import { and, asc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { staff, staffTypeChange } from '@/db/schema';
import { flagsForStaffType, staffOnDateFrom, undoableStaffTypeChange, type StaffType, type StaffTypeChange, type StaffTypeOnDate } from '@/lib/staff-type';

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

// Who was on staff on a day, as the type they had then: the one rule for the attendance page,
// the general pardon and permissions. If the history can't be read, today's status decides.
export async function staffOnDate<T extends Parameters<typeof staffOnDateFrom>[0][number]>(rows: T[], dateKey: string) {
  let changes = new Map<string, StaffTypeChange[]>();
  try {
    changes = await getStaffTypeChanges(rows.map((member) => member.id));
  } catch (error) {
    console.error("Staff type history unavailable; using today's status:", error);
  }
  return staffOnDateFrom(rows, dateKey, changes);
}

// Days before someone's first change keep the type they had, from any date in the past.
const HISTORY_START = '2000-01-01';

// From one read of their history: when the latest type change started (the next can't start
// before it) and when their latest time away began (null if they were never away).
export async function staffHistorySummary(staffId: string) {
  const changes = (await getStaffTypeChanges([staffId])).get(staffId) || [];
  return {
    awayStart: changes.filter((change) => change.staffType === 'away').at(-1)?.effectiveFrom ?? null,
    latestChangeDate: changes.filter((change) => change.staffType !== 'away').at(-1)?.effectiveFrom ?? null,
  };
}

export interface StaffTypeChangeInput {
  actorEmail?: string | null;
  effectiveFrom: string;
  // The person as the request read them; if they've changed since (another save or an undo),
  // nothing is written.
  expected: { active: boolean | null; archived: boolean | null };
  previousType: StaffType;
  staffId: string;
  staffType: StaffTypeOnDate;
  today: string;
}

// Still as the request read them (type and status), checked inside the transaction, after the lock.
function stillAsRead(input: StaffTypeChangeInput) {
  return sql`EXISTS (SELECT 1 FROM ${staff} WHERE ${staff.id} = ${input.staffId}
    AND ${staff.staffType} = ${input.previousType}
    AND ${staff.active} IS NOT DISTINCT FROM ${input.expected.active}
    AND ${staff.archived} IS NOT DISTINCT FROM ${input.expected.archived})`;
}

// The history writes for a type (or 'away') from a date. The first change also keeps the earlier
// type for every day before it. An 'away' that hasn't started yet is dropped (brought back before
// leaving); one that has started is kept, since returns can't be dated before it.
function staffTypeChangeWrites(input: StaffTypeChangeInput) {
  const createdByEmail = input.actorEmail || null;
  const unchanged = stillAsRead(input);
  return [
    // The same lock as the undo: one change to a person's history at a time.
    db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-type:${input.staffId}`}))`),
    // Locks their staff row, so the checks below hold until the staff update.
    db.select({ id: staff.id }).from(staff).where(eq(staff.id, input.staffId)).for('update'),
    // Read after the lock, so two saves at once can't both add the starting row.
    db.execute(sql`INSERT INTO ${staffTypeChange} (staff_id, staff_type, effective_from, created_by_email)
      SELECT ${input.staffId}, ${input.previousType}, ${HISTORY_START}, ${createdByEmail}
      WHERE NOT EXISTS (SELECT 1 FROM ${staffTypeChange} WHERE staff_id = ${input.staffId}) AND ${unchanged}`),
    db.delete(staffTypeChange).where(and(
      eq(staffTypeChange.staffId, input.staffId),
      or(
        eq(staffTypeChange.effectiveFrom, input.effectiveFrom),
        and(
          eq(staffTypeChange.staffType, 'away'),
          gte(staffTypeChange.effectiveFrom, input.effectiveFrom),
          gt(staffTypeChange.effectiveFrom, input.today),
        ),
      ),
      unchanged,
    )),
    db.execute(sql`INSERT INTO ${staffTypeChange} (staff_id, staff_type, effective_from, created_by_email)
      SELECT ${input.staffId}, ${input.staffType}, ${input.effectiveFrom}, ${createdByEmail}
      WHERE ${unchanged}`),
  ] as const;
}

// Saves the staff row and, with it, their type history in one transaction: both are saved or
// neither is, so today's status and the history never disagree. With a type change, an empty
// result means the person changed (or was deleted) since the request read them: nothing was saved.
export async function saveStaffWithTypeChange(
  staffId: string,
  values: Partial<typeof staff.$inferInsert>,
  change: StaffTypeChangeInput | null,
) {
  if (!change) return db.update(staff).set(values).where(eq(staff.id, staffId)).returning();
  const update = db.update(staff).set(values).where(and(eq(staff.id, staffId), stillAsRead(change))).returning();
  const results = await db.batch([...staffTypeChangeWrites(change), update]);
  return results.at(-1) as Array<typeof staff.$inferSelect>;
}

// Undoes the latest type change (see undoableStaffTypeChange), but only the one the admin
// confirmed. The history change and the staff row update run together in one batch (one
// transaction), each guarded so a concurrent change makes it a no-op instead of half an undo.
export async function undoLatestStaffTypeChange(staffId: string, expected: { effectiveFrom: string; staffType: string }) {
  const rows = await db.select({
    effectiveFrom: staffTypeChange.effectiveFrom,
    id: staffTypeChange.id,
    staffType: staffTypeChange.staffType,
  })
    .from(staffTypeChange)
    .where(eq(staffTypeChange.staffId, staffId))
    .orderBy(asc(staffTypeChange.effectiveFrom), asc(staffTypeChange.createdAt));
  const changes = rows.map((row) => ({ ...row, effectiveFrom: String(row.effectiveFrom).slice(0, 10) }));
  const undo = undoableStaffTypeChange(changes);
  const last = changes.at(-1);
  if (!undo || !last) return { status: 'nothing' as const };
  if (undo.effectiveFrom !== expected.effectiveFrom || undo.staffType !== expected.staffType) {
    return { status: 'changed' as const };
  }

  // One shared check for every write: the person is still the type being undone. If not, the
  // whole batch changes nothing (the staff update below carries the same condition).
  const stillUndoable = sql`EXISTS (SELECT 1 FROM ${staff} WHERE ${staff.id} = ${staffId} AND ${staff.staffType} = ${undo.staffType})`;
  const lastRow = and(
    eq(staffTypeChange.id, last.id),
    eq(staffTypeChange.staffType, undo.staffType),
    eq(staffTypeChange.effectiveFrom, undo.effectiveFrom),
    stillUndoable,
  );
  const historyWrites = undo.revertOnly
    // Restored as the wrong type: they stay back from that date, as the type they had.
    ? [db.update(staffTypeChange).set({ staffType: undo.previousType }).where(lastRow)]
    : [
      db.delete(staffTypeChange).where(lastRow),
      // Only the starting row left: no history is the same as one type on every day.
      ...(changes.length === 2 ? [db.delete(staffTypeChange).where(and(eq(staffTypeChange.id, changes[0].id), stillUndoable))] : []),
    ];
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-type:${staffId}`}))`),
    // Locks their staff row first, so no other save can change their type between the writes below.
    db.select({ id: staff.id }).from(staff).where(eq(staff.id, staffId)).for('update'),
    ...historyWrites,
    db.update(staff)
      .set({ ...flagsForStaffType(undo.previousType), staffType: undo.previousType, updatedAt: new Date() })
      .where(and(eq(staff.id, staffId), eq(staff.staffType, undo.staffType)))
      .returning(),
  ] as const);
  const [updated] = results.at(-1) as Array<typeof staff.$inferSelect>;
  return updated ? { status: 'undone' as const, staff: updated, undo } : { status: 'changed' as const };
}
