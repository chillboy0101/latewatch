import { currentUser } from '@clerk/nextjs/server';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staffLeavePeriod } from '@/db/schema';
import { isIsoDateKey } from '@/lib/date-format';
import { formatPermissionDays, leaveOverlapError } from '@/lib/staff-leave';
import { getAccraDateKey } from '@/lib/date-key';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import {
  findInactivePeriodOverlap,
  findOverlappingStaffLeavePeriod,
  getPermissionsCoveredByLeave,
} from '@/lib/staff-leave-service';
import { nextDateKey, publishLeaveChange, recalculateDaysAfterLeaveChange } from '@/lib/staff-leave-return';

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
    const endDate = typeof body?.endDate === 'string' ? body.endDate : '';
    if (!returnedOn && !endDate) {
      return NextResponse.json({ error: 'Select a return date or a new end date' }, { status: 400 });
    }
    if (returnedOn && (!isIsoDateKey(returnedOn) || returnedOn > getAccraDateKey())) {
      return NextResponse.json({ error: 'Select a valid actual return date that is not in the future' }, { status: 400 });
    }
    if (endDate && !isIsoDateKey(endDate)) {
      return NextResponse.json({ error: 'Select a valid end date' }, { status: 400 });
    }

    // Any open leave can be closed or extended, whichever way it was recorded.
    const [before] = await db.select()
      .from(staffLeavePeriod)
      .where(and(eq(staffLeavePeriod.id, id), ne(staffLeavePeriod.source, 'staff_status'), isNull(staffLeavePeriod.returnedOn)))
      .limit(1);
    if (!before) return NextResponse.json({ error: 'Leave period was not found or is already closed' }, { status: 404 });
    if (returnedOn && returnedOn <= before.startDate) {
      return NextResponse.json({ error: 'Return date must be after the leave start date' }, { status: 400 });
    }
    if (endDate) {
      if (endDate < before.startDate) {
        return NextResponse.json({ error: 'End date must be on or after the leave start date' }, { status: 400 });
      }
      const overlap = await findOverlappingStaffLeavePeriod({ endDate, excludeId: id, staffId: before.staffId, startDate: before.startDate });
      if (overlap) return NextResponse.json({ error: 'These dates overlap another leave period' }, { status: 409 });
      const inactive = await findInactivePeriodOverlap({ endDate, staffId: before.staffId, startDate: before.startDate });
      if (inactive) {
        return NextResponse.json({ error: `This person was deactivated from ${inactive.startDate}. The leave can't run into those dates.` }, { status: 409 });
      }
    }
    // A longer leave takes over permissions already approved on its new days (removed together).
    const replacedPermissions = endDate
      ? await getPermissionsCoveredByLeave({ endDate, staffId: before.staffId, startDate: before.startDate })
      : [];

    const actorEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system';
    const updateLeave = db.update(staffLeavePeriod)
      .set(returnedOn
        ? { closedAt: new Date(), closedByEmail: actorEmail, returnedOn, updatedAt: new Date() }
        : { endDate, updatedAt: new Date() })
      .where(eq(staffLeavePeriod.id, id))
      .returning();
    const [period] = replacedPermissions.length > 0
      ? (await db.batch([
        db.delete(attendancePermission).where(and(
          eq(attendancePermission.staffId, before.staffId),
          inArray(attendancePermission.id, replacedPermissions.map((permission) => permission.id)),
        )),
        updateLeave,
      ] as const))[1]
      : await updateLeave;
    const reason = returnedOn ? 'approved-staff-leave-early-return' : 'staff-leave-end-date-changed';

    await writeAuditEvent({
      entityType: 'staff_leave_period',
      entityId: id,
      action: 'UPDATE',
      before,
      after: replacedPermissions.length > 0 ? { ...period, replacedPermissions } : period,
      actor: { email: actorEmail, id: user?.id || null },
      reason,
    });
    for (const permission of replacedPermissions) {
      await writeAuditEvent({
        entityType: 'attendance_permission',
        entityId: permission.id,
        action: 'DELETE',
        before: { ...permission, staffId: before.staffId },
        after: null,
        actor: { email: actorEmail, id: user?.id || null },
        publish: false,
        reason: 'replaced-by-leave',
      });
    }

    // Past days whose leave status changed get the normal rules re-applied (or cleared).
    const today = getAccraDateKey();
    if (returnedOn) {
      await recalculateDaysAfterLeaveChange(returnedOn, today);
    } else {
      const oldEnd = before.endDate;
      const earlier = oldEnd && oldEnd < endDate ? oldEnd : endDate;
      const later = oldEnd && oldEnd > endDate ? oldEnd : oldEnd ? endDate : today;
      await recalculateDaysAfterLeaveChange(nextDateKey(earlier), later);
    }
    publishLeaveChange(reason, period.staffId);

    return NextResponse.json({
      ...period,
      replacedPermissionCount: replacedPermissions.length,
      replacedPermissionDays: formatPermissionDays(replacedPermissions.map((permission) => String(permission.date))),
    });
  } catch (error) {
    const overlapMessage = leaveOverlapError(error);
    if (overlapMessage) return NextResponse.json({ error: overlapMessage }, { status: 409 });
    console.error('Failed to update leave:', error);
    return NextResponse.json({ error: 'Failed to update leave' }, { status: 500 });
  }
}