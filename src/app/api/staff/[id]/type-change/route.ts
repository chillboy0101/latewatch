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
import { STAFF_TYPE_LABELS } from '@/lib/staff-type';
import { undoLatestStaffTypeChange } from '@/lib/staff-type-history';

// Undo the latest type change (a mistake): the person goes back to the type before it, and the
// days from that change are charged again by that type. Paid or pardoned charges never move.
export async function DELETE(
  request: NextRequest,
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

    // The change the admin confirmed; anything else changed meanwhile is refused, not undone.
    const expected = {
      effectiveFrom: request.nextUrl.searchParams.get('effectiveFrom') || '',
      staffType: request.nextUrl.searchParams.get('staffType') || '',
    };
    const result = await undoLatestStaffTypeChange(id, expected);
    if (result.status === 'nothing') {
      return NextResponse.json({ error: 'There is no type change to undo.' }, { status: 400 });
    }
    if (result.status === 'changed') {
      return NextResponse.json({ error: 'Their type changed meanwhile. Reload and check before undoing.' }, { status: 409 });
    }
    const { staff: updated, undo: undone } = result;

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

    // The sign-in details carry the type too; if they can't be updated, say so (Sync / Invite fixes it).
    let identitySync: string | null = null;
    if (updated.email) {
      const sync = await syncStaffEmailIdentity({
        actorUserId: actor?.id,
        email: updated.email,
        isAttendanceOnly: updated.isAttendanceOnly,
        isNssPersonnel: updated.isNssPersonnel,
        staffId: id,
        staffName: updated.fullName,
      });
      identitySync = sync.status;
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });
    publishRealtime('payments', 'invalidate', { reason: 'staff' });

    return NextResponse.json({ ...updated, identitySync });
  } catch (error) {
    console.error('Failed to undo staff type change:', error);
    return NextResponse.json({ error: 'Could not undo the type change' }, { status: 500 });
  }
}
