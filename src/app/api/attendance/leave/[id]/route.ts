import { currentUser } from '@clerk/nextjs/server';
import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staffLeavePeriod } from '@/db/schema';
import { isIsoDateKey } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { enforceRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const user = await currentUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const returnedOn = typeof body?.returnedOn === 'string' ? body.returnedOn : '';
    if (!isIsoDateKey(returnedOn) || returnedOn > getAccraDateKey()) {
      return NextResponse.json({ error: 'Select a valid actual return date that is not in the future' }, { status: 400 });
    }

    const [before] = await db.select()
      .from(staffLeavePeriod)
      .where(and(eq(staffLeavePeriod.id, id), eq(staffLeavePeriod.source, 'approved_leave'), isNull(staffLeavePeriod.returnedOn)))
      .limit(1);
    if (!before) return NextResponse.json({ error: 'Approved leave period was not found or is already closed' }, { status: 404 });
    if (returnedOn <= before.startDate) {
      return NextResponse.json({ error: 'Return date must be after the leave start date' }, { status: 400 });
    }

    const actorEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system';
    const [period] = await db.update(staffLeavePeriod)
      .set({
        closedAt: new Date(),
        closedByEmail: actorEmail,
        returnedOn,
        updatedAt: new Date(),
      })
      .where(eq(staffLeavePeriod.id, id))
      .returning();

    await writeAuditEvent({
      entityType: 'staff_leave_period',
      entityId: id,
      action: 'UPDATE',
      before,
      after: period,
      actor: { email: actorEmail, id: user?.id || null },
      reason: 'approved-staff-leave-early-return',
    });

    for (const channel of ['attendance', 'dashboard', 'entries', 'notifications', 'payments', 'staff-penalty-history', 'audit-trail']) {
      publishRealtime(channel, 'invalidate', { reason: 'approved-staff-leave-early-return', staffId: period.staffId });
    }

    return NextResponse.json(period);
  } catch (error) {
    console.error('Failed to record leave return:', error);
    return NextResponse.json({ error: 'Failed to record leave return' }, { status: 500 });
  }
}