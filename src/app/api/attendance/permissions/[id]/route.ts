import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staff } from '@/db/schema';
import { reconcileAttendanceForPermission } from '@/lib/attendance-permission-reconciliation';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const [before] = await db.select()
      .from(attendancePermission)
      .where(eq(attendancePermission.id, id))
      .limit(1);

    if (!before) {
      return NextResponse.json({ error: 'Permission record not found' }, { status: 404 });
    }

    const [member] = await db.select({ fullName: staff.fullName, id: staff.id })
      .from(staff)
      .where(eq(staff.id, before.staffId))
      .limit(1);

    await db.delete(attendancePermission).where(eq(attendancePermission.id, id));

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    await writeAuditEvent({
      entityType: 'attendance_permission',
      entityId: id,
      action: 'DELETE',
      before: {
        ...before,
        staffName: member?.fullName || null,
      },
      after: {
        arrivalWindow: before.arrivalWindow,
        date: before.date,
        expectedEndTime: before.expectedEndTime,
        expectedStartTime: before.expectedStartTime,
        permissionType: before.permissionType,
        staffName: member?.fullName || null,
      },
      actor: { email: actorEmail, id: user.id },
      reason: 'attendance-permission',
    });

    if (member) {
      await reconcileAttendanceForPermission({
        activePermission: null,
        actor: { email: actorEmail, id: user.id },
        date: before.date,
        reason: 'attendance-permission-deleted',
        staffMember: { fullName: member.fullName, id: member.id },
      });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-permission' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-permission' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete attendance permission:', error);
    return NextResponse.json({ error: 'Failed to delete attendance permission' }, { status: 500 });
  }
}
