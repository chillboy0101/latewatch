import { currentUser } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendanceRecord, latenessEntry } from '@/db/schema';
import {
  getAccraClock,
  getActiveOfficeNetwork,
  getHolidayForDate,
  getStaffByEmail,
  isOfficeIp,
  isWeekendDate,
  recordAttendanceAttempt,
  resolveClientIpInfo,
} from '@/lib/attendance';
import { getAuditActor, writeAuditEvent } from '@/lib/audit';
import { computePenalty } from '@/lib/penalty-calculator';
import { publishRealtime } from '@/lib/realtime';
import {
  isAfterWorkdayEnd,
  WORKDAY_END_LABEL,
  WORKDAY_START_LABEL,
} from '@/lib/work-hours';

export const dynamic = 'force-dynamic';

function responsePayload(input: {
  attendance?: typeof attendanceRecord.$inferSelect | null;
  currentIp: string;
  currentIpSource?: string;
  date: string;
  holidayName?: string | null;
  isHoliday: boolean;
  isAfterWorkdayEnd: boolean;
  isOfficeNetwork: boolean;
  isWeekend: boolean;
  networkConfigured: boolean;
  staff?: { id: string; fullName: string; email: string | null } | null;
  time: string;
}) {
  return {
    attendance: input.attendance
      ? {
          id: input.attendance.id,
          checkInAt: input.attendance.checkInAt,
          checkInTime: input.attendance.checkInTime,
          computedAmount: input.attendance.computedAmount,
          reason: input.attendance.reason,
          status: input.attendance.status,
        }
      : null,
    currentIp: input.currentIp,
    currentIpSource: input.currentIpSource || null,
    date: input.date,
    holidayName: input.holidayName || null,
    isHoliday: input.isHoliday,
    isAfterWorkdayEnd: input.isAfterWorkdayEnd,
    isOfficeNetwork: input.isOfficeNetwork,
    isWeekend: input.isWeekend,
    networkConfigured: input.networkConfigured,
    staff: input.staff || null,
    time: input.time,
    workdayEndLabel: WORKDAY_END_LABEL,
    workdayStartLabel: WORKDAY_START_LABEL,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorEmail = user.emailAddresses[0]?.emailAddress?.toLowerCase() || 'unknown';
    const clock = getAccraClock();
    const currentIpInfo = await resolveClientIpInfo(request);
    const currentIp = currentIpInfo.ip;
    const [member, network, holiday] = await Promise.all([
      actorEmail === 'unknown' ? Promise.resolve(null) : getStaffByEmail(actorEmail),
      getActiveOfficeNetwork(),
      getHolidayForDate(clock.dateKey),
    ]);
    const isWeekend = isWeekendDate(clock.dateKey);
    const isOfficeNetwork = network ? isOfficeIp(currentIp, network.allowedIp) : false;
    const [existingAttendance] = member
      ? await db.select()
        .from(attendanceRecord)
        .where(and(eq(attendanceRecord.staffId, member.id), eq(attendanceRecord.date, clock.dateKey)))
        .limit(1)
      : [];

    return NextResponse.json(responsePayload({
      attendance: existingAttendance || null,
      currentIp,
      currentIpSource: currentIpInfo.source,
      date: clock.dateKey,
      holidayName: holiday?.holidayNote || null,
      isHoliday: Boolean(holiday),
      isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
      isOfficeNetwork,
      isWeekend,
      networkConfigured: Boolean(network),
      staff: member ? { id: member.id, fullName: member.fullName, email: member.email } : null,
      time: clock.timeKey,
    }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load check-in status:', error);
    return NextResponse.json({ error: 'Failed to load check-in status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorEmail = user.emailAddresses[0]?.emailAddress?.toLowerCase() || 'unknown';
  const userId = user.id;
  const userAgent = request.headers.get('user-agent');
  const currentIpInfo = await resolveClientIpInfo(request);
  const currentIp = currentIpInfo.ip;
  const clock = getAccraClock();
  const checkInTime = clock.timeKey.slice(0, 5);
  const actor = await getAuditActor({ email: actorEmail, id: userId });

  async function block(result: string, message: string, status = 400, staffId?: string | null) {
    await recordAttendanceAttempt({
      date: clock.dateKey,
      networkIp: currentIp,
      result,
      staffId,
      successful: false,
      userAgent,
      userEmail: actorEmail,
      userId,
    });

    await writeAuditEvent({
      entityType: 'attendance_attempt',
      entityId: `${clock.dateKey}:${actorEmail}`,
      action: 'ALERT',
      before: null,
      after: {
        date: clock.dateKey,
        networkIp: currentIp,
        networkIpSource: currentIpInfo.source,
        result,
        staffId: staffId || null,
        userEmail: actorEmail,
      },
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'attendance-check-in',
    });

    return NextResponse.json({ error: message, result }, { status });
  }

  try {
    if (actorEmail === 'unknown') {
      return block('NO_EMAIL', 'Your login account does not have an email address.');
    }

    const member = await getStaffByEmail(actorEmail);
    if (!member) {
      return block(
        'STAFF_NOT_LINKED',
        'Your account is not linked to an active staff profile. Ask an admin to add your login email on the Staff page.',
        403,
      );
    }

    const network = await getActiveOfficeNetwork();
    if (!network) {
      return block('NETWORK_NOT_CONFIGURED', 'The office WiFi network has not been configured yet.', 403, member.id);
    }

    if (!isOfficeIp(currentIp, network.allowedIp)) {
      return block('OFFICE_NETWORK_REQUIRED', 'Connect to the office WiFi before checking in.', 403, member.id);
    }

    if (isWeekendDate(clock.dateKey)) {
      return block('WEEKEND_CLOSED', 'Attendance check-in is closed on weekends.', 400, member.id);
    }

    const holiday = await getHolidayForDate(clock.dateKey);
    if (holiday) {
      return block(
        'HOLIDAY_CLOSED',
        `Attendance check-in is closed today because it is ${holiday.holidayNote || 'a public holiday'}.`,
        400,
        member.id,
      );
    }

    const [existingAttendance] = await db.select()
      .from(attendanceRecord)
      .where(and(eq(attendanceRecord.staffId, member.id), eq(attendanceRecord.date, clock.dateKey)))
      .limit(1);

    if (existingAttendance) {
      await recordAttendanceAttempt({
        date: clock.dateKey,
        networkIp: currentIp,
        result: 'ALREADY_CHECKED_IN',
        staffId: member.id,
        successful: true,
        userAgent,
        userEmail: actorEmail,
        userId,
      });

      return NextResponse.json({
        success: true,
        alreadyCheckedIn: true,
        ...responsePayload({
          attendance: existingAttendance,
          currentIp,
          currentIpSource: currentIpInfo.source,
          date: clock.dateKey,
          isHoliday: false,
          isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
          isOfficeNetwork: true,
          isWeekend: false,
          networkConfigured: true,
          staff: { id: member.id, fullName: member.fullName, email: member.email },
          time: clock.timeKey,
        }),
      });
    }

    if (isAfterWorkdayEnd(clock.timeKey)) {
      return block(
        'CHECK_IN_CLOSED',
        `Check-ins are closed after ${WORKDAY_END_LABEL}. Ask an admin to correct attendance if needed.`,
        400,
        member.id,
      );
    }

    const penalty = computePenalty({
      arrivalTime: checkInTime,
      didNotSignOut: false,
      isHoliday: false,
    });
    const status = penalty.amount > 0 ? 'late' : 'present';
    const now = clock.now;

    const [createdAttendance] = await db.insert(attendanceRecord).values({
      staffId: member.id,
      date: clock.dateKey,
      checkInAt: now,
      checkInTime,
      status,
      source: 'staff_portal',
      networkIp: currentIp,
      userAgent,
      computedAmount: penalty.amount.toString(),
      reason: penalty.reason || null,
      updatedAt: now,
    }).returning();

    await recordAttendanceAttempt({
      date: clock.dateKey,
      networkIp: currentIp,
      result: status.toUpperCase(),
      staffId: member.id,
      successful: true,
      userAgent,
      userEmail: actorEmail,
      userId,
    });

    await writeAuditEvent({
      entityType: 'attendance',
      entityId: createdAttendance.id,
      action: 'CREATE',
      before: null,
      after: {
        ...createdAttendance,
        networkIpSource: currentIpInfo.source,
        staff: { fullName: member.fullName },
      },
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'attendance-check-in',
    });

    if (penalty.amount > 0) {
      const [existingLateness] = await db.select()
        .from(latenessEntry)
        .where(and(eq(latenessEntry.staffId, member.id), eq(latenessEntry.date, clock.dateKey)))
        .limit(1);

      const [lateness] = existingLateness
        ? await db.update(latenessEntry)
          .set({
            arrivalTime: checkInTime,
            didNotSignOut: false,
            computedAmount: penalty.amount.toString(),
            reason: penalty.reason,
            updatedAt: now,
          })
          .where(eq(latenessEntry.id, existingLateness.id))
          .returning()
        : await db.insert(latenessEntry).values({
          staffId: member.id,
          date: clock.dateKey,
          arrivalTime: checkInTime,
          didNotSignOut: false,
          computedAmount: penalty.amount.toString(),
          reason: penalty.reason,
        }).returning();

      await writeAuditEvent({
        entityType: 'entry',
        entityId: lateness.id,
        action: existingLateness ? 'UPDATE' : 'CREATE',
        before: existingLateness || null,
        after: {
          ...lateness,
          staff: { fullName: member.fullName },
          source: 'attendance_check_in',
        },
        actor: { email: actor.actorEmail, id: actor.actorUserId },
        reason: 'attendance-check-in',
      });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-check-in' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-check-in' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-check-in' });

    return NextResponse.json({
      success: true,
      alreadyCheckedIn: false,
      ...responsePayload({
        attendance: createdAttendance,
        currentIp,
        currentIpSource: currentIpInfo.source,
        date: clock.dateKey,
        isHoliday: false,
        isAfterWorkdayEnd: false,
        isOfficeNetwork: true,
        isWeekend: false,
        networkConfigured: true,
        staff: { id: member.id, fullName: member.fullName, email: member.email },
        time: clock.timeKey,
      }),
    });
  } catch (error) {
    console.error('Failed to complete attendance check-in:', error);
    return NextResponse.json({ error: 'Failed to complete attendance check-in' }, { status: 500 });
  }
}
