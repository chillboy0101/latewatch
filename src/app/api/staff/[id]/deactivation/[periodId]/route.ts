import { currentUser } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff, staffInactivePeriod } from '@/db/schema';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import { getAccraDateKey } from '@/lib/date-key';
import { publishRealtime } from '@/lib/realtime';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; periodId: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id, periodId } = await params;
    const body = await request.json().catch(() => ({}));
    const reactivatedOn = typeof body?.reactivatedOn === 'string' ? body.reactivatedOn.trim() : '';
    const today = getAccraDateKey();
    if (!DATE_KEY.test(reactivatedOn) || reactivatedOn > today) {
      return NextResponse.json({ error: 'A valid reactivation date up to today is required' }, { status: 400 });
    }

    const [before] = await db.select()
      .from(staffInactivePeriod)
      .where(and(eq(staffInactivePeriod.id, periodId), eq(staffInactivePeriod.staffId, id)))
      .limit(1);
    if (!before) return NextResponse.json({ error: 'Inactive period was not found' }, { status: 404 });
    if (before.reactivatedOn) return NextResponse.json({ error: 'This inactive period is already closed' }, { status: 409 });
    if (reactivatedOn < before.startDate) {
      return NextResponse.json({ error: 'Reactivation cannot be before deactivation' }, { status: 400 });
    }

    const actorEmail = actor.emailAddresses[0]?.emailAddress || 'unknown';
    const now = new Date();
    const [period] = await db.update(staffInactivePeriod).set({
      reactivatedAt: now,
      reactivatedByEmail: actorEmail,
      reactivatedOn,
      updatedAt: now,
    }).where(eq(staffInactivePeriod.id, periodId)).returning();
    const [updated] = await db.update(staff)
      .set({ active: true, updatedAt: now })
      .where(and(eq(staff.id, id), eq(staff.archived, false)))
      .returning();
    if (!updated) return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });

    const reconciliation = await syncLatenessEntriesFromAttendanceForRange(reactivatedOn, today);
    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: 'ACTIVATE',
      before: { ...updated, active: false, inactivePeriod: before },
      after: { ...updated, inactivePeriod: period },
      actor: { email: actorEmail, id: actor.id },
      reason: 'staff-reactivation',
    });
    for (const channel of ['attendance', 'dashboard', 'entries', 'notifications'] as const) {
      publishRealtime(channel, 'invalidate', { reason: 'staff-reactivation', staffId: id });
    }

    return NextResponse.json({ ...updated, inactivePeriod: period, reconciliation });
  } catch (error) {
    console.error('Failed to reactivate staff member:', error);
    return NextResponse.json({ error: 'Failed to reactivate staff member' }, { status: 500 });
  }
}
