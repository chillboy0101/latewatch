import 'server-only';

import { and, asc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import { staffLeavePeriod } from '@/db/schema';
import {
  applyNoShowSignInPenaltiesForRange,
  syncLatenessEntriesFromAttendanceForRange,
} from '@/lib/attendance-lateness-sync';
import { writeAuditEvent } from '@/lib/audit';
import { getAccraDateKey } from '@/lib/date-key';
import { publishRealtime } from '@/lib/realtime';

const LEAVE_CHANNELS = ['attendance', 'dashboard', 'entries', 'notifications', 'payments', 'staff-penalty-history', 'audit-trail'];

export function nextDateKey(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function publishLeaveChange(reason: string, staffId: string) {
  for (const channel of LEAVE_CHANNELS) publishRealtime(channel, 'invalidate', { reason, staffId });
}

/**
 * Re-applies the normal attendance rules (late, no sign-out, no-show) to past days whose leave
 * status changed, e.g. a return recorded after the fact. Future days need nothing.
 */
export async function recalculateDaysAfterLeaveChange(startDate: string, endDate: string) {
  const lastDate = [endDate, getAccraDateKey()].sort()[0];
  if (startDate > lastDate) return;
  await syncLatenessEntriesFromAttendanceForRange(startDate, lastDate);
  await applyNoShowSignInPenaltiesForRange(startDate, lastDate);
}

/**
 * A staff member on leave who checks in is back at work: close their leave from that day,
 * exactly as if an admin had recorded the return.
 */
export async function endLeaveOnCheckIn(input: {
  actor: { email: string; id: string | null };
  date: string;
  staffId: string;
  staffName: string;
}) {
  const [period] = await db.select()
    .from(staffLeavePeriod)
    .where(and(
      eq(staffLeavePeriod.staffId, input.staffId),
      ne(staffLeavePeriod.source, 'staff_status'),
      isNull(staffLeavePeriod.returnedOn),
      lte(staffLeavePeriod.startDate, input.date),
      or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, input.date)),
    ))
    .orderBy(asc(staffLeavePeriod.startDate))
    .limit(1);
  if (!period) return null;

  const [closed] = await db.update(staffLeavePeriod)
    .set({
      closedAt: new Date(),
      closedByEmail: input.actor.email,
      returnedOn: input.date,
      updatedAt: new Date(),
    })
    .where(and(eq(staffLeavePeriod.id, period.id), isNull(staffLeavePeriod.returnedOn)))
    .returning();
  if (!closed) return null;

  await writeAuditEvent({
    entityType: 'staff_leave_period',
    entityId: period.id,
    action: 'UPDATE',
    before: period,
    after: { ...closed, staffName: input.staffName },
    actor: input.actor,
    reason: 'staff-leave-ended-by-check-in',
  });
  publishLeaveChange('staff-leave-ended-by-check-in', input.staffId);
  return closed;
}
