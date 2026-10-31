import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, staff } from '@/db/schema';
import {
  getInclusivePermissionDateRange,
  getPermissionWindowBounds,
  normalizeAbsencePermissionReason,
  normalizeLateArrivalPermissionReason,
  normalizeMinuteTime,
  normalizePermissionWindow,
} from '@/lib/attendance-permissions';
import { reconcileAttendanceForPermission } from '@/lib/attendance-permission-reconciliation';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { enforceRole } from '@/lib/auth/roles';
import { getNonWorkdayLabel } from '@/lib/attendance';
import { formatPermissionDays, isExcuseOverlapError } from '@/lib/staff-leave';
import { getLeaveAndDeactivationCoverage } from '@/lib/staff-leave-service';
import { isAwayOnDate, type StaffTypeChange } from '@/lib/staff-type';
import { getStaffTypeChanges } from '@/lib/staff-type-history';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['late_arrival', 'absence']);
const MAX_PERMISSION_DAYS = 62;

function allCoveredMessage(name: string, leaveDates: string[], deactivatedDates: string[]) {
  const parts = [
    leaveDates.length > 0 ? `on leave on ${formatPermissionDays([...leaveDates].sort())}` : '',
    deactivatedDates.length > 0 ? `deactivated on ${formatPermissionDays(deactivatedDates)}` : '',
  ].filter(Boolean);
  return `${name} is ${parts.join(' and ')}, so no permission can be added for those days`;
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

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
      generalPardonType: attendancePermission.generalPardonType,
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

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to fetch attendance permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance permissions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const staffId = optionalText(body?.staffId);
    const date = optionalText(body?.date);
    // Both permission types can cover a date range (absenceEndDate kept for older clients).
    const endDate = optionalText(body?.endDate) || optionalText(body?.absenceEndDate) || date;
    let reason = optionalText(body?.reason);
    const permissionType = optionalText(body?.permissionType) || 'late_arrival';

    if (!staffId) return NextResponse.json({ error: 'Staff member is required' }, { status: 400 });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Valid date is required' }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'Permission reason is required' }, { status: 400 });
    if (!VALID_TYPES.has(permissionType)) return NextResponse.json({ error: 'Invalid permission type' }, { status: 400 });

    const [member] = await db.select({
      active: staff.active,
      archived: staff.archived,
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
      isAttendanceOnly: staff.isAttendanceOnly,
      isNssPersonnel: staff.isNssPersonnel,
    })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);

    // Someone deactivated or archived since can still get a permission for the days they were on
    // staff (the attendance page lists them on those days); their days away are skipped below.
    if (!member) {
      return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    }

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const now = new Date();
    let appliedDates = [date];
    let arrivalWindow: string;
    let expectedEndTime: string | null;
    let expectedStartTime: string | null;

    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: 'Valid end date is required' }, { status: 400 });
    }
    appliedDates = date === endDate ? [date] : getInclusivePermissionDateRange(date, endDate);
    if (appliedDates.length === 0) {
      return NextResponse.json({ error: 'Permission period must end on or after the start date and include at least one weekday' }, { status: 400 });
    }
    if (appliedDates.length > MAX_PERMISSION_DAYS) {
      return NextResponse.json({ error: `Permission period cannot exceed ${MAX_PERMISSION_DAYS} days` }, { status: 400 });
    }

    if (permissionType === 'absence') {
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

    // Weekends and holidays in the period are skipped; they never need a permission.
    const nonWorkdayLabels = await Promise.all(appliedDates.map((permissionDate) => getNonWorkdayLabel(permissionDate)));
    if (appliedDates.length === 1 && nonWorkdayLabels[0]) {
      return NextResponse.json({ error: `${date} is ${nonWorkdayLabels[0]}, so no permission is needed` }, { status: 400 });
    }
    appliedDates = appliedDates.filter((_, index) => !nonWorkdayLabels[index]);
    if (appliedDates.length === 0) {
      return NextResponse.json({ error: 'The selected period has no workdays' }, { status: 400 });
    }

    // Days already on leave are excused by the leave, and a deactivated person isn't charged:
    // those days are skipped (and reported) instead of failing the whole period part-way.
    const coverage = await getLeaveAndDeactivationCoverage({ endDate: appliedDates[appliedDates.length - 1], staffIds: [staffId], startDate: appliedDates[0] });
    // Days away (deactivated or archived) come from their type history, like the attendance page.
    let typeChanges: StaffTypeChange[] | undefined;
    try {
      typeChanges = (await getStaffTypeChanges([staffId])).get(staffId);
    } catch (error) {
      console.error("Staff type history unavailable; using today's status:", error);
    }
    const dayCoverage = (day: string) => coverage(staffId, day) || (isAwayOnDate(day, typeChanges, member) ? 'deactivated' : null);
    const leaveDates = appliedDates.filter((day) => dayCoverage(day) === 'leave');
    const deactivatedDates = appliedDates.filter((day) => dayCoverage(day) === 'deactivated');
    appliedDates = appliedDates.filter((day) => !dayCoverage(day));
    if (appliedDates.length === 0) {
      return NextResponse.json({ error: allCoveredMessage(member.fullName, leaveDates, deactivatedDates) }, { status: 409 });
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

      let permission;
      try {
        [permission] = existing
          ? await db.update(attendancePermission)
            .set(values)
            .where(eq(attendancePermission.id, existing.id))
            .returning()
          : await db.insert(attendancePermission)
            .values(values)
            .returning();
      } catch (error) {
        // Leave or a deactivation recorded for this day meanwhile: skip it, keep the rest.
        if (!isExcuseOverlapError(error)) throw error;
        leaveDates.push(permissionDate);
        continue;
      }

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
          isAttendanceOnly: member.isAttendanceOnly,
          isNssPersonnel: member.isNssPersonnel,
        },
      });

      permissions.push(permission);
      reconciliations.push({ date: permissionDate, ...reconciliation });
    }

    const permission = permissions[0];
    if (!permission) {
      return NextResponse.json({ error: allCoveredMessage(member.fullName, leaveDates, deactivatedDates) }, { status: 409 });
    }
    // Report only the days actually saved.
    appliedDates = permissions.map((saved) => String(saved.date).slice(0, 10));

    // Editing a permission saved with the wrong date or person: the old one goes, and its day
    // is recalculated under the normal rules (unless the edit kept that same day and person).
    const replacesPermissionId = optionalText(body?.replacesPermissionId);
    let replacedPermission = null;
    if (replacesPermissionId) {
      const [old] = await db.select().from(attendancePermission).where(eq(attendancePermission.id, replacesPermissionId)).limit(1);
      const keptInPlace = old && permissions.some((saved) => saved.id === old.id);
      if (old && !keptInPlace) {
        await db.delete(attendancePermission).where(eq(attendancePermission.id, old.id));
        const [oldMember] = await db.select({
          fullName: staff.fullName,
          id: staff.id,
          isAttendanceOnly: staff.isAttendanceOnly,
          isNssPersonnel: staff.isNssPersonnel,
        }).from(staff).where(eq(staff.id, old.staffId)).limit(1);
        await writeAuditEvent({
          entityType: 'attendance_permission',
          entityId: old.id,
          action: 'DELETE',
          before: { ...old, staffName: oldMember?.fullName || null },
          after: null,
          actor: { email: actorEmail, id: user.id },
          reason: 'attendance-permission-corrected',
        });
        if (oldMember) {
          await reconcileAttendanceForPermission({
            activePermission: null,
            actor: { email: actorEmail, id: user.id },
            date: old.date,
            reason: 'attendance-permission-corrected',
            staffMember: oldMember,
          });
        }
        replacedPermission = { date: old.date, staffId: old.staffId };
      }
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-permission' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-permission' });
    publishRealtime('attendance', 'invalidate', { reason: 'attendance-permission' });
    publishRealtime('entries', 'invalidate', { reason: 'attendance-permission' });
    publishRealtime('payments', 'invalidate', { reason: 'attendance-permission', staffId });
    publishRealtime('staff-penalty-history', 'invalidate', { reason: 'attendance-permission', staffId });
    publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-permission' });

    return NextResponse.json({
      ...permission,
      appliedDates,
      permissions,
      reconciliation: reconciliations[0] || null,
      reconciliations,
      replacedPermission,
      skippedDeactivatedDays: formatPermissionDays(deactivatedDates),
      skippedLeaveDays: formatPermissionDays([...leaveDates].sort()),
      staffEmail: member.email,
      staffName: member.fullName,
    });
  } catch (error) {
    console.error('Failed to save attendance permission:', error);
    return NextResponse.json({ error: 'Failed to save attendance permission' }, { status: 500 });
  }
}
