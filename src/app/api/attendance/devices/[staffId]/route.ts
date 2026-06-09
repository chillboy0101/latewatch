import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff, staffDevice } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import {
  isStaffSessionRevocationError,
  revokeStaffLoginSessions,
} from '@/lib/clerk-session-revocation';
import { disableActivePushSubscriptionsForStaff } from '@/lib/push-subscriptions';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { staffId } = await params;
    const [member] = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
    })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    }

    const [before] = await db.select()
      .from(staffDevice)
      .where(eq(staffDevice.staffId, staffId))
      .limit(1);

    const now = new Date();
    const sessionRevocation = await revokeStaffLoginSessions({
      deviceUserId: before?.userId,
      staffEmail: member.email,
    });
    const revokedSessions = sessionRevocation.revokedSessions;
    const disabledPushSubscriptions = await disableActivePushSubscriptionsForStaff(staffId, now);

    if (!before) {
      return NextResponse.json({
        disabledPushSubscriptions,
        reset: false,
        revokedSessions,
        sessionRevocation,
        success: true,
      });
    }

    await db.delete(staffDevice).where(eq(staffDevice.staffId, staffId));

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    await writeAuditEvent({
      entityType: 'staff_device',
      entityId: staffId,
      action: 'DELETE',
      before: {
        lastSeenAt: before.lastSeenAt,
        registeredAt: before.registeredAt,
        staffName: member.fullName,
      },
      after: {
        disabledPushSubscriptions,
        revokedSessions,
        sessionRevocation,
        staffName: member.fullName,
      },
      actor: { email: actorEmail, id: user.id },
      reason: 'attendance-device-reset',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-device-reset' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-device-reset' });

    return NextResponse.json({
      disabledPushSubscriptions,
      reset: true,
      revokedSessions,
      sessionRevocation,
      success: true,
    });
  } catch (error) {
    if (isStaffSessionRevocationError(error)) {
      console.error('Failed to revoke staff login sessions during attendance device reset:', error);
      return NextResponse.json({
        error: 'Could not revoke staff login sessions. Try again before resetting the attendance device.',
        result: 'SESSION_REVOCATION_FAILED',
        revokedSessions: error.revokedSessions,
      }, { status: 502 });
    }

    console.error('Failed to reset attendance device:', error);
    return NextResponse.json({ error: 'Failed to reset attendance device' }, { status: 500 });
  }
}
