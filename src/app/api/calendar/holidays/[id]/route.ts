// app/api/calendar/holidays/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';

// GET single holiday
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const holiday = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.id, id),
    });

    if (!holiday) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    return NextResponse.json(holiday);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch holiday' }, { status: 500 });
  }
}

// PUT - Mark as holiday or update
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isHoliday, holidayNote, isRemoved } = body;

    const existing = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    const updated = await db.update(workCalendar)
      .set({
        isHoliday: isHoliday !== undefined ? isHoliday : existing.isHoliday,
        holidayNote: holidayNote !== undefined ? holidayNote : existing.holidayNote,
        isRemoved: isRemoved !== undefined ? isRemoved : existing.isRemoved,
        source: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(workCalendar.id, id))
      .returning();

    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error('Failed to update holiday:', error);
    return NextResponse.json({ error: 'Failed to update holiday' }, { status: 500 });
  }
}

// DELETE - Remove holiday
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(workCalendar).where(eq(workCalendar.id, id));

    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete holiday:', error);
    return NextResponse.json({ error: 'Failed to delete holiday' }, { status: 500 });
  }
}
