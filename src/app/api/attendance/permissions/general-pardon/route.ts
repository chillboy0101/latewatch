import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staff } from '@/db/schema';
import { getPermissionWindowBounds } from '@/lib/attendance-permissions';
import { reconcileAttendanceForPermission } from '@/lib/attendance-permission-reconciliation';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const VALID_PARDON_TYPES = new Set(['absence', 'late_arrival']);
function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const date = optionalText(body?.date);
    const pardonType = optionalText(body?.pardonType);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date is required' }, { status: 400 });
    }
    if (!pardonType || !VALID_PARDON_TYPES.has(pardonType)) {
      return NextResponse.json({ error: 'Invalid pardon type' }, { status: 400 });
    }

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const actor = { email: actorEmail, id: user.id };
    const members = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
      isAttendanceOnly: staff.isAttendanceOnly,
      isNssPersonnel: staff.isNssPersonnel,
    })
      .from(staff)
      .where(and(eq(staff.active, true), eq(staff.archived, false)))
      .orderBy(asc(staff.displayOrder), asc(staff.fullName));

    const now = new Date();
    const permissions = [];
    const reconciliations = [];
    const lateArrivalBounds = getPermissionWindowBounds({
      arrivalWindow: 'any_time_today',
      permissionType: 'late_arrival',
    });
    const permissionValues = pardonType === 'absence'
      ? {
          arrivalWindow: 'full_day',
          expectedEndTime: null,
          expectedStartTime: null,
          permissionType: 'absence',
        }
      : {
          arrivalWindow: 'any_time_today',
          expectedEndTime: lateArrivalBounds.endTime,
          expectedStartTime: lateArrivalBounds.startTime,
          permissionType: 'late_arrival',
        };

    for (const member of members) {
      const [existing] = await db.select()
        .from(attendancePermission)
        .where(and(eq(attendancePermission.staffId, member.id), eq(attendancePermission.date, date)))
        .limit(1);

      const values = {
        ...permissionValues,
        approvedByEmail: actorEmail,
        approvedByUserId: user.id,
        date,
        reason: 'general pardon',
        staffId: member.id,
        status: 'approved',
        updatedAt: now,
      };

      const [permission] = existing
        ? await db.update(attendancePermission)
          .set(values)
          .where(eq(attendancePermission.id, existing.id))
          .returning()
        : await db.insert(attendancePermission)
          .values(values)
          .returning();

      await writeAuditEvent({
        entityType: 'attendance_permission',
        entityId: permission.id,
        action: existing ? 'UPDATE' : 'CREATE',
        before: existing || null,
        after: {
          ...permission,
          staffName: member.fullName,
        },
        actor,
        reason: 'attendance-general-pardon',
      });

      const reconciliation = await reconcileAttendanceForPermission({
        activePermission: permission,
        actor,
        date,
        reason: 'attendance-general-pardon',
        staffMember: {
          fullName: member.fullName,
          id: member.id,
          isNssPersonnel: member.isNssPersonnel,
        },
      });

      permissions.push(permission);
      reconciliations.push({
        staffId: member.id,
        ...reconciliation,
      });
    }

    await writeAuditEvent({
      entityType: 'attendance_general_pardon',
      entityId: `${date}:${pardonType}`,
      action: 'CREATE',
      before: null,
      after: {
        affectedCount: permissions.length,
        date,
        pardonType,
        reason: 'general pardon',
        staffIds: members.map((member) => member.id),
      },
      actor,
      reason: 'attendance-general-pardon',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-general-pardon' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-general-pardon' });
    publishRealtime('attendance', 'invalidate', { reason: 'attendance-general-pardon' });
    publishRealtime('entries', 'invalidate', { reason: 'attendance-general-pardon' });
    publishRealtime('payments', 'invalidate', { date, reason: 'attendance-general-pardon' });
    publishRealtime('staff-penalty-history', 'invalidate', { date, reason: 'attendance-general-pardon' });

    return NextResponse.json({
      affectedCount: permissions.length,
      date,
      pardonType,
      permissions,
      reconciliations,
    });
  } catch (error) {
    console.error('Failed to apply general attendance pardon:', error);
    return NextResponse.json({ error: 'Failed to apply general pardon' }, { status: 500 });
  }
}
