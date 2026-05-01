// app/api/calendar/holidays/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';

// POST - Create a new holiday entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, isHoliday, holidayNote, source } = body;

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    // Check if exists
    const existing = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.date, date),
    });

    let result;
    if (existing) {
      const before = { ...existing };
      [result] = await db.update(workCalendar)
        .set({
          isHoliday: isHoliday ?? true,
          holidayNote: holidayNote ?? existing.holidayNote,
          source: source || 'manual',
          isRemoved: false,
          updatedAt: new Date(),
        })
        .where(eq(workCalendar.id, existing.id))
        .returning();

      await writeAuditEvent({
        entityType: 'calendar',
        entityId: result.id,
        action: 'UPDATE',
        before,
        after: result,
        reason: 'calendar',
      });
    } else {
      [result] = await db.insert(workCalendar).values({
        date,
        isHoliday: isHoliday ?? true,
        holidayNote,
        source: source || 'manual',
        isRemoved: false,
      }).returning();

      await writeAuditEvent({
        entityType: 'calendar',
        entityId: result.id,
        action: 'CREATE',
        before: null,
        after: result,
        reason: 'calendar',
      });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to create holiday:', error);
    return NextResponse.json({ error: 'Failed to create holiday' }, { status: 500 });
  }
}
