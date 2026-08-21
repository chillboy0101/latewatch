import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staff, staffLeavePeriod } from '@/db/schema';
import {
  MAX_LEAVE_PERMISSION_DAYS,
  getInclusivePermissionDateRange,
  getPermissionWindowBounds,
  normalizeAbsencePermissionReason,
  normalizeLateArrivalPermissionReason,
  normalizeLeavePermissionType,
  normalizeMinuteTime,
  normalizePermissionWindow,
} from '@/lib/attendance-permissions';
import { reconcileAttendanceForPermission } from '@/lib/attendance-permission-reconciliation';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { getLeavePeriodsForDate, leavePeriodToPermission } from '@/lib/staff-leave-periods';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { getAccraDateKey } from '@/lib/date-key';
import { getAllInactivePeriods, inactivePeriodMap, isStaffActiveForDate } from '@/lib/staff-inactive-periods';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['late_arrival', 'absence', 'leave']);
const MAX_ABSENCE_DAYS = 62;

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
  publishRealtime('dashboard', 'invalidate', { reason: 'attendance-permission' });
  publishRealtime('notifications', 'invalidate', { reason: 'attendance-permission' });
  publishRealtime('attendance', 'invalidate', { reason: 'attendance-permission' });
  publishRealtime('entries', 'invalidate', { reason: 'attendance-permission' });
  publishRealtime('payments', 'invalidate', { reason: 'attendance-permission', staffId });
  publishRealtime('staff-penalty-history', 'invalidate', { reason: 'attendance-permission', staffId });
}

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date');
    const whereClause = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? eq(attendancePermission.date, date)
      : undefined;

    const rows = await db.select({
      approvedByEmail: attendancePermission.approvedByEmail,
      createdAt: attendancePermission.createdAt,
      date: attendancePermission.date,
      arrivalWindow: attendancePermission.arrivalWindow,
      expectedEndTime: attendancePermission.expectedEndTime,
      expectedStartTime: attendancePermission.expectedStartTime,
      id: attendancePermission.id,
      permissionType: attendancePermission.permissionType,
      reason: attendancePermission.reason,
      staffEmail: staff.email,
      staffId: attendancePermission.staffId,
      staffName: staff.fullName,
      status: attendancePermission.status,
      updatedAt: attendancePermission.updatedAt,
    })
      .from(attendancePermission)
      .leftJoin(staff, eq(attendancePermission.staffId, staff.id))
      .where(whereClause)
      .orderBy(asc(staff.fullName));

    const leavePeriods = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? await getLeavePeriodsForDate(date)
      : [];
    const leaveStaffRows = leavePeriods.length
      ? await db.select({ email: staff.email, fullName: staff.fullName, id: staff.id })
        .from(staff)
        .where(inArray(staff.id, leavePeriods.map((period) => period.staffId)))
      : [];
    const leaveStaffById = new Map(leaveStaffRows.map((member) => [member.id, member]));
    const leaveRows = leavePeriods.map((period) => ({
      ...leavePeriodToPermission(period, date || period.startDate),
      staffEmail: leaveStaffById.get(period.staffId)?.email || null,
      staffName: leaveStaffById.get(period.staffId)?.fullName || null,
    }));

    return NextResponse.json([...rows, ...leaveRows], {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to fetch attendance permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance permissions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const staffId = optionalText(body?.staffId);
    const date = optionalText(body?.date ?? body?.startDate);
    const absenceEndDate = optionalText(body?.absenceEndDate) || date;
    let reason = optionalText(body?.reason);
    const permissionType = optionalText(body?.permissionType) || 'late_arrival';

    if (!staffId) return NextResponse.json({ error: 'Staff member is required' }, { status: 400 });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Valid date is required' }, { status: 400 });
    if (!VALID_TYPES.has(permissionType)) return NextResponse.json({ error: 'Invalid permission type' }, { status: 400 });
    if (permissionType !== 'leave' && !reason) return NextResponse.json({ error: 'Permission reason is required' }, { status: 400 });

    const [member] = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
      active: staff.active,
      isNssPersonnel: staff.isNssPersonnel,
    })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.archived, false)))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    }
    const inactiveByStaffId = inactivePeriodMap(await getAllInactivePeriods([staffId]));
    if (!isStaffActiveForDate(member, date, inactiveByStaffId)) {
      return NextResponse.json({ error: 'Reactivate this staff member before granting an attendance permission for this date.' }, { status: 409 });
    }

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const now = new Date();

    if (permissionType === 'leave') {
      const endDate = optionalText(body?.endDate);
      const leaveType = normalizeLeavePermissionType(body?.leaveType);
      const note = optionalText(body?.note);
      if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return NextResponse.json({ error: 'Leave end date must be a valid date or omitted for open-ended leave' }, { status: 400 });
      }
      if (!leaveType) {
        return NextResponse.json({ error: 'Select a valid leave type' }, { status: 400 });
      }

      const leaveDates = endDate ? getInclusivePermissionDateRange(date, endDate) : [];
      if (endDate && leaveDates.length === 0) {
        return NextResponse.json({ error: 'Leave end date must be on or after the start date' }, { status: 400 });
      }
      if (endDate && leaveDates.length > MAX_LEAVE_PERMISSION_DAYS) {
        return NextResponse.json({ error: `Leave period cannot exceed ${MAX_LEAVE_PERMISSION_DAYS} days` }, { status: 400 });
      }

      const [permissionConflicts, leaveConflicts] = await Promise.all([
        db.select({ date: attendancePermission.date, permissionType: attendancePermission.permissionType })
          .from(attendancePermission)
          .where(and(
            eq(attendancePermission.staffId, staffId),
            gte(attendancePermission.date, date),
            endDate ? lte(attendancePermission.date, endDate) : undefined,
            eq(attendancePermission.status, 'approved'),
          )),
        db.select({ endDate: staffLeavePeriod.endDate, id: staffLeavePeriod.id, startDate: staffLeavePeriod.startDate })
          .from(staffLeavePeriod)
          .where(and(
            eq(staffLeavePeriod.staffId, staffId),
            endDate ? lte(staffLeavePeriod.startDate, endDate) : undefined,
            or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, date)),
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

      const [period] = await db.insert(staffLeavePeriod)
        .values({
          createdByEmail: actorEmail,
          endDate,
          leaveType,
          note,
          source: 'attendance_permission',
          staffId,
          startDate: date,
          updatedByEmail: actorEmail,
        })
        .returning();

      const leavePermission = leavePeriodToPermission(period, date);
      await writeAuditEvent({
        entityType: 'attendance_permission',
        entityId: period.id,
        action: 'CREATE',
        before: null,
        after: { ...leavePermission, staffName: member.fullName },
        actor: { email: actorEmail, id: user.id },
        reason: 'attendance-leave-permission',
      });

      const reconciliation = await syncLatenessEntriesFromAttendanceForRange(date, endDate || getAccraDateKey());
      publishPermissionInvalidations(staffId);

      return NextResponse.json({
        ...leavePermission,
        reconciliation,
        staffEmail: member.email,
        staffName: member.fullName,
      });
    }

    let appliedDates = [date];
    let arrivalWindow: string;
    let expectedEndTime: string | null;
    let expectedStartTime: string | null;

    if (permissionType === 'absence') {
      if (!absenceEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(absenceEndDate)) {
        return NextResponse.json({ error: 'Valid absence end date is required' }, { status: 400 });
      }

      appliedDates = getInclusivePermissionDateRange(date, absenceEndDate);
      if (appliedDates.length === 0) {
        return NextResponse.json({ error: 'Absence end date must be on or after the start date' }, { status: 400 });
      }
      if (appliedDates.length > MAX_ABSENCE_DAYS) {
        return NextResponse.json({ error: `Absence period cannot exceed ${MAX_ABSENCE_DAYS} days` }, { status: 400 });
      }

      const selectedReason = normalizeAbsencePermissionReason(reason);
      if (!selectedReason) return NextResponse.json({ error: 'Select a valid excused absence reason' }, { status: 400 });
      reason = selectedReason;

      arrivalWindow = 'full_day';
      expectedEndTime = null;
      expectedStartTime = null;
    } else {
      const selectedReason = normalizeLateArrivalPermissionReason(reason);
      if (!selectedReason) return NextResponse.json({ error: 'Select a valid late arrival reason' }, { status: 400 });
      reason = selectedReason;

      arrivalWindow = normalizePermissionWindow(body?.arrivalWindow);
      const expectedTime = normalizeMinuteTime(body?.expectedEndTime ?? body?.expectedByTime);

      if (arrivalWindow === 'specific_time' && !expectedTime) {
        return NextResponse.json({ error: 'Expected arrival time is required' }, { status: 400 });
      }

      const windowBounds = getPermissionWindowBounds({
        arrivalWindow,
        expectedEndTime: expectedTime,
        permissionType,
      });
      expectedEndTime = windowBounds.endTime;
      expectedStartTime = windowBounds.startTime;
    }

    const permissionEndDate = appliedDates[appliedDates.length - 1] || date;
    const leaveConflicts = await db.select({ endDate: staffLeavePeriod.endDate, id: staffLeavePeriod.id, startDate: staffLeavePeriod.startDate })
      .from(staffLeavePeriod)
      .where(and(
        eq(staffLeavePeriod.staffId, staffId),
        lte(staffLeavePeriod.startDate, permissionEndDate),
        or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, date)),
      ));
    if (leaveConflicts.length) {
      return NextResponse.json({
        error: 'Permission overlaps an existing leave range',
        conflicts: { leaveRanges: leaveConflicts },
      }, { status: 409 });
    }

    const permissions = [];
    const reconciliations = [];

    for (const permissionDate of appliedDates) {
      const [existing] = await db.select()
        .from(attendancePermission)
        .where(and(eq(attendancePermission.staffId, staffId), eq(attendancePermission.date, permissionDate)))
        .limit(1);

      const values = {
        arrivalWindow,
        approvedByEmail: actorEmail,
        approvedByUserId: user.id,
        date: permissionDate,
        expectedEndTime,
        expectedStartTime,
        permissionType,
        reason,
        staffId,
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
        actor: { email: actorEmail, id: user.id },
        reason: 'attendance-permission',
      });

      const reconciliation = await reconcileAttendanceForPermission({
        activePermission: permission,
        actor: { email: actorEmail, id: user.id },
        date: permissionDate,
        reason: 'attendance-permission',
        staffMember: {
          fullName: member.fullName,
          id: member.id,
          isNssPersonnel: member.isNssPersonnel,
        },
      });

      permissions.push(permission);
      reconciliations.push({ date: permissionDate, ...reconciliation });
    }

    publishPermissionInvalidations(staffId);

    const permission = permissions[0];

    return NextResponse.json({
      ...permission,
      appliedDates,
      permissions,
      reconciliation: reconciliations[0] || null,
      reconciliations,
      staffEmail: member.email,
      staffName: member.fullName,
    });
  } catch (error) {
    if (isPermissionOverlapError(error)) {
      return NextResponse.json({ error: 'Permission overlaps an existing attendance permission' }, { status: 409 });
    }
    console.error('Failed to save attendance permission:', error);
    return NextResponse.json({ error: 'Failed to save attendance permission' }, { status: 500 });
  }
}
