import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { publishRealtime } from '@/lib/realtime';
import { normalizeStaffEmail } from '@/lib/staff-normalize';

function statusMessage(status: string) {
  switch (status) {
    case 'member_added':
      return 'Login access linked to an existing Clerk account.';
    case 'already_member':
      return 'Login access is already linked.';
    case 'invitation_sent':
      return 'Login invitation sent to the staff email.';
    case 'invitation_exists':
      return 'A login invitation is already pending for this staff email.';
    case 'organization_not_configured':
      return 'Clerk organization is not configured.';
    case 'clerk_not_configured':
      return 'Clerk is not configured for identity sync.';
    case 'sync_failed':
      return 'Clerk identity sync failed.';
    default:
      return 'Login access synced.';
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await currentUser();
    const { id } = await params;

    const [member] = await db.select()
      .from(staff)
      .where(eq(staff.id, id))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    const email = normalizeStaffEmail(member.email);
    if (!email) {
      return NextResponse.json(
        { error: 'Add a login email before syncing account access.' },
        { status: 400 },
      );
    }

    const syncResult = await syncStaffEmailIdentity({
      actorUserId: actor?.id,
      email,
      isAttendanceOnly: member.isAttendanceOnly,
      isNssPersonnel: member.isNssPersonnel,
      staffId: member.id,
      staffName: member.fullName,
    });

    await writeAuditEvent({
      entityType: 'staff',
      entityId: member.id,
      action: 'SYNC',
      before: null,
      after: {
        email,
        identityStatus: syncResult.status,
        staffName: member.fullName,
      },
      actor: {
        email: actor?.emailAddresses[0]?.emailAddress,
        id: actor?.id,
      },
      reason: 'staff-identity-sync',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff-identity-sync' });

    const success = !['clerk_not_configured', 'organization_not_configured', 'sync_failed'].includes(syncResult.status);

    return NextResponse.json({
      message: statusMessage(syncResult.status),
      status: syncResult.status,
      success,
    }, { status: success ? 200 : 502 });
  } catch (error) {
    console.error('Failed to sync staff identity:', error);
    return NextResponse.json({ error: 'Failed to sync staff login access' }, { status: 500 });
  }
}
