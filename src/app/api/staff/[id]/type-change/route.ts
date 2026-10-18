// app/api/staff/[id]/type-change/route.ts
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { publishRealtime } from '@/lib/realtime';
import { recalculateStaffStoredPenalties } from '@/lib/staff-penalty-recalculation-server';
import { flagsForStaffType, STAFF_TYPE_LABELS } from '@/lib/staff-type';
import { undoLatestStaffTypeChange } from '@/lib/staff-type-history';

// Undo the latest type change (a mistake): the person goes back to the type before it, and the
// days from that change are charged again by that type. Paid or pardoned charges never move.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const actor = await currentUser();
    const { id } = await params;
    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }
    if (before.active !== true || before.archived === true) {
      return NextResponse.json({ error: 'Bring this person back (Activate or Restore) before undoing a type change.' }, { status: 400 });
    }

    const undone = await undoLatestStaffTypeChange(id);
    if (!undone) {
      return NextResponse.json({ error: 'There is no type change to undo.' }, { status: 400 });
    }

    const [updated] = await db.update(staff)
      .set({ ...flagsForStaffType(undone.previousType), staffType: undone.previousType, updatedAt: new Date() })
      .where(eq(staff.id, id))
      .returning();

    const actorRef = { email: actor?.emailAddresses[0]?.emailAddress, id: actor?.id };
    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: 'UPDATE',
      before,
      after: {
        ...updated,
        typeChangeUndone: {
          effectiveFrom: undone.effectiveFrom,
          from: STAFF_TYPE_LABELS[undone.staffType],
          to: STAFF_TYPE_LABELS[undone.previousType],
        },
      },
      reason: 'staff-type-change-undone',
    });

    await recalculateStaffStoredPenalties({
      actor: actorRef,
      reason: 'staff-type-change-undone',
      staffMember: {
        fullName: updated.fullName,
        id: updated.id,
        isAttendanceOnly: updated.isAttendanceOnly,
        isNssPersonnel: updated.isNssPersonnel,
      },
    });

    if (updated.email) {
      await syncStaffEmailIdentity({
        actorUserId: actor?.id,
        email: updated.email,
        isAttendanceOnly: updated.isAttendanceOnly,
        isNssPersonnel: updated.isNssPersonnel,
        staffId: id,
        staffName: updated.fullName,
      });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });
    publishRealtime('payments', 'invalidate', { reason: 'staff' });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to undo staff type change:', error);
    return NextResponse.json({ error: 'Could not undo the type change' }, { status: 500 });
  }
}
