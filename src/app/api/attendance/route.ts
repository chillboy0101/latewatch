import { and, asc, desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendanceAttempt, attendancePermission, attendanceRecord, staff, staffDevice } from '@/db/schema';
import { getAccraClock, getActiveOfficeNetwork, isOfficeIp, resolveClientIpInfo } from '@/lib/attendance';
import { isPermissionWindowOverdue } from '@/lib/attendance-permissions';
import { shouldAlertNoSignOut } from '@/lib/work-hours';

export const dynamic = 'force-dynamic';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requiredAttendanceQuery<T>(label: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    console.error(`Attendance query failed (${label}); retrying once:`, error);
    await wait(250);
    return query();
  }
}

async function optionalAttendanceQuery<T>(label: string, fallback: T, query: () => Promise<T>): Promise<T> {
  try {
    return await requiredAttendanceQuery(label, query);
  } catch (error) {
    console.error(`Optional attendance query failed (${label}); using fallback:`, error);
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const clock = getAccraClock();
    const date = url.searchParams.get('date') || clock.dateKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const [staffRows, attendanceRows, permissionRows] = await Promise.all([
      requiredAttendanceQuery('staff', () => db.select({
        id: staff.id,
        fullName: staff.fullName,
        email: staff.email,
        department: staff.department,
        unit: staff.unit,
        active: staff.active,
        archived: staff.archived,
      })
        .from(staff)
        .where(and(eq(staff.active, true), eq(staff.archived, false)))
        .orderBy(asc(staff.displayOrder), asc(staff.fullName))),
      requiredAttendanceQuery('attendance-records', () => db.select()
        .from(attendanceRecord)
        .where(eq(attendanceRecord.date, date))),
      requiredAttendanceQuery('attendance-permissions', () => db.select({
        approvedByEmail: attendancePermission.approvedByEmail,
        arrivalWindow: attendancePermission.arrivalWindow,
        date: attendancePermission.date,
        expectedEndTime: attendancePermission.expectedEndTime,
        expectedStartTime: attendancePermission.expectedStartTime,
        id: attendancePermission.id,
        permissionType: attendancePermission.permissionType,
        reason: attendancePermission.reason,
        staffId: attendancePermission.staffId,
        status: attendancePermission.status,
      })
        .from(attendancePermission)
        .where(and(eq(attendancePermission.date, date), eq(attendancePermission.status, 'approved')))),
    ]);

    const [attemptRows, deviceRows, network] = await Promise.all([
      optionalAttendanceQuery('attendance-attempts', [], () => db.select()
        .from(attendanceAttempt)
        .where(eq(attendanceAttempt.date, date))
        .orderBy(desc(attendanceAttempt.createdAt))
        .limit(25)),
      optionalAttendanceQuery('staff-devices', [], () => db.select({
        id: staffDevice.id,
        lastSeenAt: staffDevice.lastSeenAt,
        registeredAt: staffDevice.registeredAt,
        staffId: staffDevice.staffId,
      })
        .from(staffDevice)),
      optionalAttendanceQuery('office-network', null, getActiveOfficeNetwork),
    ]);

    const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
    const permissionByStaffId = new Map(permissionRows.map((row) => [row.staffId, row]));
    const deviceByStaffId = new Map(deviceRows.map((row) => [row.staffId, row]));
    const rows = staffRows.map((member) => {
      const attendance = attendanceByStaffId.get(member.id) || null;
      const permission = permissionByStaffId.get(member.id) || null;
      const device = deviceByStaffId.get(member.id) || null;
      const noSignOut = Boolean(
        attendance &&
        !attendance.signOutTime &&
        (date < clock.dateKey || (date === clock.dateKey && shouldAlertNoSignOut(clock.timeKey))),
      );
      const fallbackStatus = (() => {
        if (!permission) return 'not_checked_in';
        if (permission.permissionType === 'absence') return 'excused';
        if (isPermissionWindowOverdue(permission, date, clock.dateKey, clock.timeKey)) return 'permission_overdue';
        return 'expected_late';
      })();
      return {
        staff: member,
        attendance: attendance
          ? {
              id: attendance.id,
              checkInAt: attendance.checkInAt,
              checkInTime: attendance.checkInTime,
              computedAmount: attendance.computedAmount,
              reason: attendance.reason,
              signOutAt: attendance.signOutAt,
              signOutTime: attendance.signOutTime,
              status: attendance.status,
            }
          : null,
        device: device
          ? {
              id: device.id,
              lastSeenAt: device.lastSeenAt,
              registered: true,
              registeredAt: device.registeredAt,
            }
          : {
              id: null,
              lastSeenAt: null,
              registered: false,
              registeredAt: null,
            },
        permission,
        status: noSignOut
          ? 'no_sign_out'
          : attendance?.status || fallbackStatus,
      };
    });

    const currentIpInfo = await optionalAttendanceQuery('current-ip', {
      ip: 'unknown',
      isPublic: false,
      source: 'local' as const,
    }, () => resolveClientIpInfo(request));
    const currentIp = currentIpInfo.ip;
    const totals = rows.reduce((acc, row) => {
      if (row.status === 'present') acc.present += 1;
      else if (row.status === 'late') acc.late += 1;
      else if (row.status === 'excused') acc.excused += 1;
      else if (row.status === 'expected_late') acc.expectedLate += 1;
      else if (row.status === 'permission_overdue') acc.permissionOverdue += 1;
      else if (row.status === 'no_sign_out') acc.noSignOut += 1;
      else acc.notCheckedIn += 1;
      return acc;
    }, { excused: 0, expectedLate: 0, late: 0, noSignOut: 0, notCheckedIn: 0, permissionOverdue: 0, present: 0 });

    return NextResponse.json({
      date,
      rows,
      attempts: attemptRows.map((attempt) => ({
        id: attempt.id,
        createdAt: attempt.createdAt,
        result: attempt.result,
        successful: attempt.successful,
        userEmail: attempt.userEmail,
      })),
      permissions: permissionRows,
      network: {
        configured: Boolean(network),
        allowedIp: network?.allowedIp || null,
        currentIp,
        currentIpSource: currentIpInfo.source,
        isOfficeNetwork: network ? isOfficeIp(currentIp, network.allowedIp) : false,
        name: network?.name || null,
        updatedAt: network?.updatedAt || null,
        updatedByEmail: network?.updatedByEmail || null,
      },
      totals: {
        ...totals,
        totalStaff: rows.length,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to fetch attendance:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 });
  }
}
