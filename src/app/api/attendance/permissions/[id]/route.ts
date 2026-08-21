import { currentUser } from '@clerk/nextjs/server';
import { and, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staff, staffLeavePeriod } from '@/db/schema';
import {
  getInclusivePermissionDateRange,
  getLeaveEndDateForReturn,
  getLeaveResumeDate,
  MAX_LEAVE_PERMISSION_DAYS,
  normalizeLeavePermissionType,
} from '@/lib/attendance-permissions';
import { reconcileAttendanceForPermission } from '@/lib/attendance-permission-reconciliation';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { writeAuditEvent } from '@/lib/audit';
import { getAccraDateKey } from '@/lib/date-key';
import { publishRealtime } from '@/lib/realtime';
import { leavePeriodToPermission } from '@/lib/staff-leave-periods';

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPermissionOverlapError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { cause?: { code?: string; message?: string }; code?: string; message?: string };
  return candidate.code === '23P01' || candidate.cause?.code === '23P01'
    || candidate.message?.includes('attendance_permission_overlap') === true
    || candidate.cause?.message?.includes('attendance_permission_overlap') === true;
}

function publishPermissionInvalidations(staffId: string) {
  for (const channel of ['dashboard', 'notifications', 'attendance', 'entries'] as const) {
    publishRealtime(channel, 'invalidate', { reason: 'attendance-permission' });
  }
  publishRealtime('payments', 'invalidate', { reason: 'attendance-permission', staffId });
  publishRealtime('staff-penalty-history', 'invalidate', { reason: 'attendance-permission', staffId });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const [before] = await db.select().from(staffLeavePeriod).where(eq(staffLeavePeriod.id, id)).limit(1);
    if (!before) return NextResponse.json({ error: 'Leave permission not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const returnedOn = optionalText(body?.returnedOn);
    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';

    if (returnedOn) {
      const endDate = getLeaveEndDateForReturn(returnedOn);
      if (!endDate || returnedOn <= before.startDate) {
        return NextResponse.json({ error: 'First day back must be after the leave start date' }, { status: 400 });
      }

      const scheduledResumeDate = getLeaveResumeDate(before.endDate);
      if (scheduledResumeDate && returnedOn > scheduledResumeDate) {
        return NextResponse.json({ error: 'Use Change to extend this leave beyond its scheduled return date' }, { status: 400 });
      }

      const [updated] = await db.update(staffLeavePeriod)
        .set({
          closedAt: new Date(),
          closedByEmail: actorEmail,
          endDate,
          updatedAt: new Date(),
          updatedByEmail: actorEmail,
        })
        .where(eq(staffLeavePeriod.id, id))
        .returning();

      const [member] = await db.select({ fullName: staff.fullName, email: staff.email })
        .from(staff).where(eq(staff.id, before.staffId)).limit(1);
      await writeAuditEvent({
        entityType: 'attendance_permission', entityId: id, action: 'UPDATE',
        before: { ...leavePeriodToPermission(before), staffName: member?.fullName || null },
        after: {
          ...leavePeriodToPermission(updated),
          changeType: 'leave_returned',
          returnedOn,
          staffName: member?.fullName || null,
        },
        actor: { email: actorEmail, id: user.id }, reason: 'attendance-leave-returned',
      });

      const today = getAccraDateKey();
      const reconciliationEnd = before.endDate && before.endDate > today ? before.endDate : today;
      const reconciliation = returnedOn <= reconciliationEnd
        ? await syncLatenessEntriesFromAttendanceForRange(returnedOn, reconciliationEnd)
        : { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
      publishPermissionInvalidations(before.staffId);

      return NextResponse.json({
        ...leavePeriodToPermission(updated),
        reconciliation,
        returnedOn,
        staffEmail: member?.email || null,
        staffName: member?.fullName || null,
      });
    }

    const startDate = optionalText(body?.startDate);
    const endDate = optionalText(body?.endDate);
    const leaveType = normalizeLeavePermissionType(body?.leaveType);
    const note = optionalText(body?.note);
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
      return NextResponse.json({ error: 'Valid leave start date and optional end date are required' }, { status: 400 });
    }
    const dates = endDate ? getInclusivePermissionDateRange(startDate, endDate) : [];
    if (endDate && !dates.length) return NextResponse.json({ error: 'Leave end date must be on or after the start date' }, { status: 400 });
    if (endDate && before.endDate && dates.length > MAX_LEAVE_PERMISSION_DAYS) {
      return NextResponse.json({ error: `Leave period cannot exceed ${MAX_LEAVE_PERMISSION_DAYS} days` }, { status: 400 });
    }
    if (!leaveType) return NextResponse.json({ error: 'Select a valid leave type' }, { status: 400 });

    const [permissionConflicts, leaveConflicts] = await Promise.all([
      db.select({ date: attendancePermission.date, permissionType: attendancePermission.permissionType })
        .from(attendancePermission)
        .where(and(
          eq(attendancePermission.staffId, before.staffId),
          gte(attendancePermission.date, startDate),
          endDate ? lte(attendancePermission.date, endDate) : undefined,
          eq(attendancePermission.status, 'approved'),
        )),
      db.select({ endDate: staffLeavePeriod.endDate, id: staffLeavePeriod.id, startDate: staffLeavePeriod.startDate })
        .from(staffLeavePeriod)
        .where(and(
          eq(staffLeavePeriod.staffId, before.staffId),
          ne(staffLeavePeriod.id, id),
          endDate ? lte(staffLeavePeriod.startDate, endDate) : undefined,
          or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, startDate)),
        )),
    ]);
    if (permissionConflicts.length || leaveConflicts.length) {
      return NextResponse.json({
        error: 'Leave overlaps an existing attendance permission',
        conflicts: {
          dates: permissionConflicts.map((conflict) => ({ date: conflict.date, permissionType: conflict.permissionType })),
          leaveRanges: leaveConflicts,
        },
      }, { status: 409 });
    }

    const [updated] = await db.update(staffLeavePeriod)
      .set({
        closedAt: endDate ? new Date() : null,
        closedByEmail: endDate ? actorEmail : null,
        endDate,
        leaveType,
        note,
        startDate,
        updatedAt: new Date(),
        updatedByEmail: actorEmail,
      })
      .where(eq(staffLeavePeriod.id, id))
      .returning();

    const [member] = await db.select({ fullName: staff.fullName, email: staff.email })
      .from(staff).where(eq(staff.id, before.staffId)).limit(1);
    await writeAuditEvent({
      entityType: 'attendance_permission', entityId: id, action: 'UPDATE',
      before: { ...leavePeriodToPermission(before), staffName: member?.fullName || null },
      after: { ...leavePeriodToPermission(updated), staffName: member?.fullName || null },
      actor: { email: actorEmail, id: user.id }, reason: 'attendance-leave-permission',
    });

    const reconcileStart = before.startDate < startDate ? before.startDate : startDate;
    const beforeEnd = before.endDate || getAccraDateKey();
    const nextEnd = endDate || getAccraDateKey();
    const reconcileEnd = beforeEnd > nextEnd ? beforeEnd : nextEnd;
    const reconciliation = await syncLatenessEntriesFromAttendanceForRange(reconcileStart, reconcileEnd);
    publishPermissionInvalidations(before.staffId);

    return NextResponse.json({ ...leavePeriodToPermission(updated), reconciliation, staffEmail: member?.email || null, staffName: member?.fullName || null });
  } catch (error) {
    if (isPermissionOverlapError(error)) {
      return NextResponse.json({ error: 'Leave overlaps an existing attendance permission' }, { status: 409 });
    }
    console.error('Failed to update leave permission:', error);
    return NextResponse.json({ error: 'Failed to update leave permission' }, { status: 500 });
  }
}

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
    const [leaveBefore] = await db.select()
      .from(staffLeavePeriod)
      .where(eq(staffLeavePeriod.id, id))
      .limit(1);

    if (leaveBefore) {
      const [member] = await db.select({ fullName: staff.fullName, id: staff.id, isNssPersonnel: staff.isNssPersonnel })
        .from(staff).where(eq(staff.id, leaveBefore.staffId)).limit(1);
      await db.delete(staffLeavePeriod).where(eq(staffLeavePeriod.id, id));
      const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
      await writeAuditEvent({
        entityType: 'attendance_permission', entityId: id, action: 'DELETE',
        before: { ...leavePeriodToPermission(leaveBefore), staffName: member?.fullName || null },
        after: null, actor: { email: actorEmail, id: user.id }, reason: 'attendance-leave-permission',
      });
      await syncLatenessEntriesFromAttendanceForRange(leaveBefore.startDate, leaveBefore.endDate || getAccraDateKey());
      publishPermissionInvalidations(leaveBefore.staffId);
      return NextResponse.json({ success: true });
    }

    const [before] = await db.select()
      .from(attendancePermission)
      .where(eq(attendancePermission.id, id))
      .limit(1);

    if (!before) {
      return NextResponse.json({ error: 'Permission record not found' }, { status: 404 });
    }

    const [member] = await db.select({
      fullName: staff.fullName,
      id: staff.id,
      isNssPersonnel: staff.isNssPersonnel,
    })
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
        staffMember: {
          fullName: member.fullName,
          id: member.id,
          isNssPersonnel: member.isNssPersonnel,
        },
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
