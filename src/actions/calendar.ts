// actions/calendar.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { updateTag } from 'next/cache';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { eq } from 'drizzle-orm';

export async function getCalendar(year: number, month: number) {
  await requireRole(['admin', 'hr', 'viewer']);

  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(year, month + 1, 0);
  const endDateStr = endDate.toISOString().split('T')[0];

  const days = await db.query.workCalendar.findMany({
    where: (calendar, { and, gte, lte }) =>
      and(
        gte(calendar.date, startDate),
        lte(calendar.date, endDateStr)
      ),
    orderBy: (calendar, { asc }) => [asc(calendar.date)],
  });

  return days;
}

export async function markHoliday(date: string, note?: string) {
  const user = await requireRole(['admin']);

  const existing = await db.query.workCalendar.findFirst({
    where: (c, { eq }) => eq(c.date, date),
  });

  let calendar;
  if (existing) {
    const before = { ...existing };
    [calendar] = await db.update(workCalendar)
      .set({
        isHoliday: true,
        holidayNote: note,
        updatedAt: new Date(),
      })
      .where(eq(workCalendar.id, existing.id))
      .returning();

    await writeAuditEvent({
      entityType: 'calendar',
      entityId: calendar.id,
      action: 'UPDATE',
      before,
      after: calendar,
      actor: user,
      reason: 'calendar',
    });
  } else {
    [calendar] = await db.insert(workCalendar).values({
      date,
      isHoliday: true,
      holidayNote: note,
    }).returning();

    await writeAuditEvent({
      entityType: 'calendar',
      entityId: calendar.id,
      action: 'CREATE',
      before: null,
      after: calendar,
      actor: user,
      reason: 'calendar',
    });
  }

  const monthNum = parseInt(date.split('-')[1]);
  updateTag(`calendar-${monthNum}`);
  publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });

  return calendar;
}

export async function unmarkHoliday(date: string) {
  const user = await requireRole(['admin']);

  const existing = await db.query.workCalendar.findFirst({
    where: (c, { eq }) => eq(c.date, date),
  });

  if (!existing) {
    throw new Error('Calendar entry not found');
  }

  const before = { ...existing };
  const [calendar] = await db.update(workCalendar)
    .set({
      isHoliday: false,
      holidayNote: null,
      updatedAt: new Date(),
    })
    .where(eq(workCalendar.id, existing.id))
    .returning();

  await writeAuditEvent({
    entityType: 'calendar',
    entityId: calendar.id,
    action: 'UPDATE',
    before,
    after: calendar,
    actor: user,
    reason: 'calendar',
  });

  const monthNum = parseInt(date.split('-')[1]);
  updateTag(`calendar-${monthNum}`);
  publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });

  return calendar;
}
