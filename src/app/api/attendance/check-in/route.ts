import { currentUser } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendanceRecord, latenessEntry, staffDevice } from '@/db/schema';
import {
  getAccraClock,
  getActiveOfficeNetwork,
  getApprovedAttendancePermission,
  getHolidayForDate,
  getOrAutoLinkStaffByEmail,
  isOfficeIp,
  isWeekendDate,
  recordAttendanceAttempt,
  resolveClientIpInfo,
} from '@/lib/attendance';
import { getPermissionWindowBounds, isPermissionWindowActive } from '@/lib/attendance-permissions';
import { getAuditActor, writeAuditEvent } from '@/lib/audit';
import { computePenalty } from '@/lib/penalty-calculator';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { getDeviceTokenFromRequest, hashDeviceToken } from '@/lib/device-binding';
import { publishRealtime } from '@/lib/realtime';
import {
  canSignOutNow,
  isAfterWorkdayEnd,
  NO_SIGN_OUT_ALERT_LABEL,
  SIGN_OUT_START_LABEL,
  WORKDAY_END_LABEL,
  WORKDAY_START_LABEL,
} from '@/lib/work-hours';

export const dynamic = 'force-dynamic';

function getUserFullName(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  return user.fullName
    || [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || null;
}

async function resolveMemberForAttendance(input: {
  actorEmail: string;
  actorId: string;
  fullName: string | null;
}) {
  const resolved = await getOrAutoLinkStaffByEmail({
    email: input.actorEmail,
    fullName: input.fullName,
  });

  if (resolved.autoLinked && resolved.before && resolved.member) {
    await writeAuditEvent({
      entityType: 'staff',
      entityId: resolved.member.id,
      action: 'UPDATE',
      before: resolved.before,
      after: {
        ...resolved.member,
        autoLinkedFromAttendance: true,
      },
      actor: { email: input.actorEmail, id: input.actorId },
      reason: 'attendance-auto-link',
    });

    await syncStaffEmailIdentity({
      actorUserId: input.actorId,
      email: input.actorEmail,
      staffId: resolved.member.id,
      staffName: resolved.member.fullName,
    });
  }

  return resolved.member;
}

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
  device?: {
    registered: boolean;
    trusted: boolean;
    lastSeenAt?: Date | string | null;
    registeredAt?: Date | string | null;
  } | null;
  permission?: {
    arrivalWindow?: string | null;
    date: string;
    expectedEndTime?: string | null;
    expectedStartTime?: string | null;
    id: string;
    permissionType: string;
    reason: string;
    status: string;
  } | null;
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
          signOutAt: input.attendance.signOutAt,
          signOutTime: input.attendance.signOutTime,
          signOutNetworkIp: input.attendance.signOutNetworkIp,
          status: input.attendance.status,
        }
      : null,
    currentIp: input.currentIp,
    currentIpSource: input.currentIpSource || null,
    date: input.date,
    holidayName: input.holidayName || null,
    isHoliday: input.isHoliday,
    isAfterWorkdayEnd: input.isAfterWorkdayEnd,
    device: input.device || null,
    isOfficeNetwork: input.isOfficeNetwork,
    isWeekend: input.isWeekend,
    networkConfigured: input.networkConfigured,
    officeCodeRequired: false,
    permission: input.permission || null,
    staff: input.staff || null,
    time: input.time,
    noSignOutAlertLabel: NO_SIGN_OUT_ALERT_LABEL,
    signOutStartLabel: SIGN_OUT_START_LABEL,
    workdayEndLabel: WORKDAY_END_LABEL,
    workdayStartLabel: WORKDAY_START_LABEL,
  };
}

function serializePermission(permission: {
  arrivalWindow?: string | null;
  date: string;
  expectedEndTime?: string | null;
  expectedStartTime?: string | null;
  id: string;
  permissionType: string;
  reason: string;
  status: string;
} | null | undefined) {
  return permission
    ? {
        arrivalWindow: permission.arrivalWindow || null,
        date: permission.date,
        expectedEndTime: permission.expectedEndTime || null,
        expectedStartTime: permission.expectedStartTime || null,
        id: permission.id,
        permissionType: permission.permissionType,
        reason: permission.reason,
        status: permission.status,
      }
    : null;
}

function serializeDevice(device: {
  deviceHash?: string;
  lastSeenAt?: Date | string | null;
  registeredAt?: Date | string | null;
} | null | undefined, deviceHash: string | null) {
  return {
    lastSeenAt: device?.lastSeenAt || null,
    registered: Boolean(device),
    registeredAt: device?.registeredAt || null,
    trusted: Boolean(!device || (deviceHash && device.deviceHash === deviceHash)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorEmail = user.emailAddresses[0]?.emailAddress?.toLowerCase() || 'unknown';
    const actorFullName = getUserFullName(user);
    const clock = getAccraClock();
    const currentIpInfo = await resolveClientIpInfo(request);
    const currentIp = currentIpInfo.ip;
    const deviceToken = getDeviceTokenFromRequest(request);
    const deviceHash = deviceToken ? hashDeviceToken(deviceToken) : null;
    const [member, network, holiday] = await Promise.all([
      actorEmail === 'unknown'
        ? Promise.resolve(null)
        : resolveMemberForAttendance({
          actorEmail,
          actorId: user.id,
          fullName: actorFullName,
        }),
      getActiveOfficeNetwork(),
      getHolidayForDate(clock.dateKey),
    ]);
    const isWeekend = isWeekendDate(clock.dateKey);
    const isOfficeNetwork = network ? isOfficeIp(currentIp, network.allowedIp) : false;
    const permission = member
      ? await getApprovedAttendancePermission(member.id, clock.dateKey)
      : null;
    const [existingAttendance] = member
      ? await db.select()
        .from(attendanceRecord)
        .where(and(eq(attendanceRecord.staffId, member.id), eq(attendanceRecord.date, clock.dateKey)))
        .limit(1)
      : [];
    const [registeredDevice] = member
      ? await db.select({
        deviceHash: staffDevice.deviceHash,
        lastSeenAt: staffDevice.lastSeenAt,
        registeredAt: staffDevice.registeredAt,
      })
        .from(staffDevice)
        .where(eq(staffDevice.staffId, member.id))
        .limit(1)
      : [];

    return NextResponse.json(responsePayload({
      attendance: existingAttendance || null,
      currentIp,
      currentIpSource: currentIpInfo.source,
      date: clock.dateKey,
      device: serializeDevice(registeredDevice || null, deviceHash),
      holidayName: holiday?.holidayNote || null,
      isHoliday: Boolean(holiday),
      isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
      isOfficeNetwork,
      isWeekend,
      networkConfigured: Boolean(network),
      permission: serializePermission(permission),
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
  const actorFullName = getUserFullName(user);
  const userAgent = request.headers.get('user-agent');
  const currentIpInfo = await resolveClientIpInfo(request);
  const currentIp = currentIpInfo.ip;
  const clock = getAccraClock();
  const checkInTime = clock.timeKey.slice(0, 5);
  const actor = await getAuditActor({ email: actorEmail, id: userId });
  const body = await request.json().catch(() => ({}));
  const action = body?.action === 'sign_out' ? 'sign_out' : 'check_in';
  const deviceToken = getDeviceTokenFromRequest(request, body);
  const deviceHash = deviceToken ? hashDeviceToken(deviceToken) : null;

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

    const member = await resolveMemberForAttendance({
      actorEmail,
      actorId: userId,
      fullName: actorFullName,
    });
    if (!member) {
      return block(
        'STAFF_NOT_LINKED',
        'Your login could not be matched to an active staff profile. Ask an admin to confirm your name or staff email on the Staff page.',
        403,
      );
    }
    const staffMember = member;

    if (!deviceToken || !deviceHash) {
      return block('DEVICE_REQUIRED', 'This browser could not be registered as your attendance device. Refresh the page and try again.', 403, staffMember.id);
    }
    const trustedDeviceHash = deviceHash;

    const [registeredDevice] = await db.select()
      .from(staffDevice)
      .where(eq(staffDevice.staffId, staffMember.id))
      .limit(1);

    if (registeredDevice && registeredDevice.deviceHash !== trustedDeviceHash) {
      return block(
        'REGISTERED_DEVICE_REQUIRED',
        'This account is already linked to another device. Ask an admin to reset your attendance device.',
        403,
        staffMember.id,
      );
    }

    const permission = await getApprovedAttendancePermission(staffMember.id, clock.dateKey);
    if (permission?.permissionType === 'absence') {
      return block(
        'PERMISSION_ABSENCE',
        'You have an approved absence for today. No check-in is required.',
        400,
        staffMember.id,
      );
    }

    const network = await getActiveOfficeNetwork();
    if (!network) {
      return block('NETWORK_NOT_CONFIGURED', 'The office WiFi network has not been configured yet.', 403, staffMember.id);
    }

    if (!isOfficeIp(currentIp, network.allowedIp)) {
      return block('OFFICE_NETWORK_REQUIRED', 'Connect to the office WiFi before checking in.', 403, staffMember.id);
    }

    if (isWeekendDate(clock.dateKey)) {
      return block('WEEKEND_CLOSED', 'Attendance check-in is closed on weekends.', 400, staffMember.id);
    }

    const holiday = await getHolidayForDate(clock.dateKey);
    if (holiday) {
      return block(
        'HOLIDAY_CLOSED',
        `Attendance check-in is closed today because it is ${holiday.holidayNote || 'a public holiday'}.`,
        400,
        staffMember.id,
      );
    }

    const [existingAttendance] = await db.select()
      .from(attendanceRecord)
      .where(and(eq(attendanceRecord.staffId, staffMember.id), eq(attendanceRecord.date, clock.dateKey)))
      .limit(1);

    async function syncTrustedDevice() {
      if (registeredDevice) {
        await db.update(staffDevice)
          .set({
            lastSeenAt: clock.now,
            lastSeenIp: currentIp,
            updatedAt: clock.now,
            userAgent,
            userId,
          })
          .where(eq(staffDevice.id, registeredDevice.id));
        return;
      }

      await db.insert(staffDevice)
        .values({
          deviceHash: trustedDeviceHash,
          lastSeenAt: clock.now,
          lastSeenIp: currentIp,
          registeredIp: currentIp,
          staffId: staffMember.id,
          updatedAt: clock.now,
          userAgent,
          userId,
        })
        .onConflictDoNothing();

      await writeAuditEvent({
        entityType: 'staff_device',
        entityId: staffMember.id,
        action: 'CREATE',
        before: null,
        after: {
          lastSeenIp: currentIp,
          registeredIp: currentIp,
          staffName: staffMember.fullName,
          userEmail: actorEmail,
        },
        actor: { email: actor.actorEmail, id: actor.actorUserId },
        reason: 'attendance-device-binding',
      });
    }

    if (existingAttendance) {
      if (action === 'sign_out') {
        if (existingAttendance.signOutTime) {
          return NextResponse.json({
            success: true,
            alreadySignedOut: true,
            ...responsePayload({
              attendance: existingAttendance,
              currentIp,
              currentIpSource: currentIpInfo.source,
              date: clock.dateKey,
              device: serializeDevice(registeredDevice || null, trustedDeviceHash),
              isHoliday: false,
              isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
              isOfficeNetwork: true,
              isWeekend: false,
              networkConfigured: true,
              permission: serializePermission(permission),
              staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
              time: clock.timeKey,
            }),
          });
        }

        if (!canSignOutNow(clock.timeKey)) {
          return block(
            'SIGN_OUT_NOT_OPEN',
            `Sign-out opens at ${SIGN_OUT_START_LABEL}.`,
            400,
            staffMember.id,
          );
        }

        await syncTrustedDevice();

        const [updatedAttendance] = await db.update(attendanceRecord)
          .set({
            signOutAt: clock.now,
            signOutNetworkIp: currentIp,
            signOutTime: checkInTime,
            signOutUserAgent: userAgent,
            updatedAt: clock.now,
          })
          .where(eq(attendanceRecord.id, existingAttendance.id))
          .returning();

        await recordAttendanceAttempt({
          date: clock.dateKey,
          networkIp: currentIp,
          result: 'SIGNED_OUT',
          staffId: staffMember.id,
          successful: true,
          userAgent,
          userEmail: actorEmail,
          userId,
        });

        await writeAuditEvent({
          entityType: 'attendance',
          entityId: updatedAttendance.id,
          action: 'UPDATE',
          before: existingAttendance,
          after: {
            ...updatedAttendance,
            networkIpSource: currentIpInfo.source,
            staff: { fullName: staffMember.fullName },
          },
          actor: { email: actor.actorEmail, id: actor.actorUserId },
          reason: 'attendance-sign-out',
        });

        publishRealtime('dashboard', 'invalidate', { reason: 'attendance-sign-out' });
        publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-sign-out' });
        publishRealtime('notifications', 'invalidate', { reason: 'attendance-sign-out' });

        return NextResponse.json({
          success: true,
          signedOut: true,
          ...responsePayload({
            attendance: updatedAttendance,
            currentIp,
            currentIpSource: currentIpInfo.source,
            date: clock.dateKey,
            device: serializeDevice(registeredDevice || {
              deviceHash: trustedDeviceHash,
              lastSeenAt: clock.now,
              registeredAt: clock.now,
            }, trustedDeviceHash),
            isHoliday: false,
            isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
            isOfficeNetwork: true,
            isWeekend: false,
            networkConfigured: true,
            permission: serializePermission(permission),
            staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
            time: clock.timeKey,
          }),
        });
      }

      await recordAttendanceAttempt({
        date: clock.dateKey,
        networkIp: currentIp,
        result: 'ALREADY_CHECKED_IN',
        staffId: staffMember.id,
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
          device: serializeDevice(registeredDevice || null, trustedDeviceHash),
          isHoliday: false,
          isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
          isOfficeNetwork: true,
          isWeekend: false,
          networkConfigured: true,
          permission: serializePermission(permission),
          staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
          time: clock.timeKey,
        }),
      });
    }

    if (action === 'sign_out') {
      return block('CHECK_IN_REQUIRED', 'You need to check in before signing out.', 400, staffMember.id);
    }

    if (isAfterWorkdayEnd(clock.timeKey)) {
      return block(
        'CHECK_IN_CLOSED',
        `Check-ins are closed after ${WORKDAY_END_LABEL}. Ask an admin to correct attendance if needed.`,
        400,
        staffMember.id,
      );
    }

    await syncTrustedDevice();

    const rawPenalty = computePenalty({
      arrivalTime: checkInTime,
      didNotSignOut: false,
      isHoliday: false,
    });
    const hasActiveLatePermission = isPermissionWindowActive(permission, checkInTime);
    const permissionWindow = getPermissionWindowBounds(permission);
    const penalty = hasActiveLatePermission
      ? {
          amount: 0,
          reason: `Approved late arrival (${permissionWindow.label}): ${permission?.reason || ''}`.trim(),
        }
      : rawPenalty;
    const status = penalty.amount > 0 ? 'late' : 'present';
    const now = clock.now;

    const [createdAttendance] = await db.insert(attendanceRecord).values({
      staffId: staffMember.id,
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
      staffId: staffMember.id,
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
        officeNetworkStatus: 'verified',
        permission: serializePermission(permission),
        staff: { fullName: staffMember.fullName },
      },
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'attendance-check-in',
    });

    if (penalty.amount > 0) {
      const [existingLateness] = await db.select()
        .from(latenessEntry)
        .where(and(eq(latenessEntry.staffId, staffMember.id), eq(latenessEntry.date, clock.dateKey)))
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
          staffId: staffMember.id,
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
          staff: { fullName: staffMember.fullName },
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
        device: serializeDevice(registeredDevice || {
          deviceHash: trustedDeviceHash,
          lastSeenAt: now,
          registeredAt: now,
        }, trustedDeviceHash),
        isHoliday: false,
        isAfterWorkdayEnd: false,
        isOfficeNetwork: true,
        isWeekend: false,
        networkConfigured: true,
        permission: serializePermission(permission),
        staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
        time: clock.timeKey,
      }),
    });
  } catch (error) {
    console.error('Failed to complete attendance check-in:', error);
    return NextResponse.json({ error: 'Failed to complete attendance check-in' }, { status: 500 });
  }
}
