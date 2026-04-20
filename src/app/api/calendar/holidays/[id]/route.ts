// app/api/calendar/holidays/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar, auditEvent } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { currentUser } from '@clerk/nextjs/server';

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

    // Get current user for audit
    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

    const existing = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    const before = { ...existing };
    const [updated] = await db.update(workCalendar)
      .set({
        isHoliday: isHoliday !== undefined ? isHoliday : existing.isHoliday,
        holidayNote: holidayNote !== undefined ? holidayNote : existing.holidayNote,
        isRemoved: isRemoved !== undefined ? isRemoved : existing.isRemoved,
        source: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(workCalendar.id, id))
      .returning();

    // Audit log
    await db.insert(auditEvent).values({
      entityType: 'calendar',
      entityId: id,
      action: 'UPDATE',
      beforeJson: before,
      afterJson: updated,
      actorUserId,
      actorEmail,
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });

    return NextResponse.json(updated);
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

    // Get current user for audit
    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

    const [before] = await db.select().from(workCalendar).where(eq(workCalendar.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    await db.delete(workCalendar).where(eq(workCalendar.id, id));

    // Audit log
    await db.insert(auditEvent).values({
      entityType: 'calendar',
      entityId: id,
      action: 'DELETE',
      beforeJson: before,
      afterJson: null,
      actorUserId,
      actorEmail,
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete holiday:', error);
    return NextResponse.json({ error: 'Failed to delete holiday' }, { status: 500 });
  }
}
