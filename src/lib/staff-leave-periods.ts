import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { staffLeavePeriod } from '@/db/schema';
import { getAccraDateKey } from '@/lib/date-key';

type StaffStatusSnapshot = {
  active?: boolean | null;
  archived?: boolean | null;
  id: string;
};

type StaffLeaveTransitionInput = {
  action: string;
  actorEmail?: string | null;
  after: StaffStatusSnapshot;
  before: StaffStatusSnapshot;
  transitionDate?: string;
};

function previousDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function transitionActorEmail(value: string | null | undefined) {
  return value?.trim() || 'system';
}

async function openStaffLeavePeriod(staffId: string, dateKey: string, actorEmail: string) {
  const [existingOpenPeriod] = await db.select({ id: staffLeavePeriod.id })
    .from(staffLeavePeriod)
    .where(and(
      eq(staffLeavePeriod.staffId, staffId),
      isNull(staffLeavePeriod.endDate),
    ))
    .limit(1);

  if (existingOpenPeriod) return;

  await db.insert(staffLeavePeriod)
    .values({
      createdByEmail: actorEmail,
      source: 'staff_status',
      staffId,
      startDate: dateKey,
    })
    .onConflictDoNothing();
}

async function closeStaffLeavePeriod(staffId: string, dateKey: string, actorEmail: string) {
  const [openPeriod] = await db.select()
    .from(staffLeavePeriod)
    .where(and(
      eq(staffLeavePeriod.staffId, staffId),
      isNull(staffLeavePeriod.endDate),
    ))
    .orderBy(desc(staffLeavePeriod.startDate))
    .limit(1);

  if (!openPeriod) return;

  const previousDate = previousDateKey(dateKey);
  const endDate = previousDate < openPeriod.startDate ? openPeriod.startDate : previousDate;

  await db.update(staffLeavePeriod)
    .set({
      closedAt: new Date(),
      closedByEmail: actorEmail,
      endDate,
      updatedAt: new Date(),
    })
    .where(eq(staffLeavePeriod.id, openPeriod.id));
}

export async function recordStaffLeaveTransition(input: StaffLeaveTransitionInput) {
  const dateKey = input.transitionDate || getAccraDateKey();
  const actorEmail = transitionActorEmail(input.actorEmail);

  if (
    input.action === 'DEACTIVATE' &&
    input.before.active !== false &&
    input.after.active === false &&
    input.after.archived !== true
  ) {
    await openStaffLeavePeriod(input.after.id, dateKey, actorEmail);
    return;
  }

  if (
    input.action === 'ACTIVATE' &&
    input.before.active === false &&
    input.after.active === true
  ) {
    await closeStaffLeavePeriod(input.after.id, dateKey, actorEmail);
  }
}
