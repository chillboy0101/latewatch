import { and, asc, desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendanceAttempt, attendanceRecord, staff } from '@/db/schema';
import { getAccraClock, getActiveOfficeNetwork, getClientIp, isOfficeIp } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || getAccraClock().dateKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const [staffRows, attendanceRows, attemptRows, network] = await Promise.all([
      db.select({
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
        .orderBy(asc(staff.displayOrder), asc(staff.fullName)),
      db.select()
        .from(attendanceRecord)
        .where(eq(attendanceRecord.date, date)),
      db.select()
        .from(attendanceAttempt)
        .where(eq(attendanceAttempt.date, date))
        .orderBy(desc(attendanceAttempt.createdAt))
        .limit(25),
      getActiveOfficeNetwork(),
    ]);

    const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
    const rows = staffRows.map((member) => {
      const attendance = attendanceByStaffId.get(member.id) || null;
      return {
        staff: member,
        attendance: attendance
          ? {
              id: attendance.id,
              checkInAt: attendance.checkInAt,
              checkInTime: attendance.checkInTime,
              computedAmount: attendance.computedAmount,
              reason: attendance.reason,
              status: attendance.status,
            }
          : null,
        status: attendance?.status || 'not_checked_in',
      };
    });

    const currentIp = getClientIp(request);
    const totals = rows.reduce((acc, row) => {
      if (row.status === 'present') acc.present += 1;
      else if (row.status === 'late') acc.late += 1;
      else acc.notCheckedIn += 1;
      return acc;
    }, { late: 0, notCheckedIn: 0, present: 0 });

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
      network: {
        configured: Boolean(network),
        allowedIp: network?.allowedIp || null,
        currentIp,
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
