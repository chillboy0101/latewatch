import { currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendanceRecord, deviceTransferRequest, latenessEntry, officeLocation as officeLocationTable, staffDevice } from '@/db/schema';
import {
  getAccraClock,
  getActiveOfficeLocation,
  getApprovedAttendancePermission,
  getHolidayForDate,
  getOrAutoLinkStaffByEmail,
  isWeekendDate,
  recordAttendanceAttempt,
  resolveClientIpInfo,
} from '@/lib/attendance';
import { syncLatenessEntriesFromAttendanceForDate } from '@/lib/attendance-lateness-sync';
import { getPermissionWindowBounds, isPermissionWindowActive } from '@/lib/attendance-permissions';
import { getAuditActor, writeAuditEvent } from '@/lib/audit';
import { computePenalty } from '@/lib/penalty-calculator';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { getDeviceTokenFromRequest, hashDeviceToken } from '@/lib/device-binding';
import { type LocationValidationResult, validateAttendanceLocation } from '@/lib/geo-location';
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

function getUserEmailAddresses(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const emails = [
    user.primaryEmailAddress?.emailAddress,
    ...user.emailAddresses.map((emailAddress) => emailAddress.emailAddress),
  ]
    .map((email) => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  return Array.from(new Set(emails));
}

function getDeviceLabel(value: unknown, userAgent: string | null) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 120);
  }

  if (!userAgent) return 'Attendance browser';
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone or iPad browser';
  if (/android/i.test(userAgent)) return 'Android browser';
  if (/edg/i.test(userAgent)) return 'Microsoft Edge browser';
  if (/chrome/i.test(userAgent)) return 'Chrome browser';
  if (/safari/i.test(userAgent)) return 'Safari browser';
  if (/firefox/i.test(userAgent)) return 'Firefox browser';
  return 'Attendance browser';
}

function locationForDb(location: LocationValidationResult | null | undefined) {
  return {
    accuracyMeters: location?.accuracy == null ? null : location.accuracy.toString(),
    distanceMeters: location?.distanceMeters == null ? null : location.distanceMeters.toString(),
    latitude: location?.latitude == null ? null : location.latitude.toString(),
    locationAt: location?.locationAt || null,
    longitude: location?.longitude == null ? null : location.longitude.toString(),
    verificationResult: location?.result || null,
  };
}

function locationForAudit(location: LocationValidationResult | null | undefined) {
  return {
    accuracyMeters: location?.accuracy == null ? null : Number(location.accuracy.toFixed(2)),
    distanceMeters: location?.distanceMeters == null ? null : Number(location.distanceMeters.toFixed(2)),
    latitude: location?.latitude == null ? null : Number(location.latitude.toFixed(7)),
    locationAt: location?.locationAt?.toISOString() || null,
    longitude: location?.longitude == null ? null : Number(location.longitude.toFixed(7)),
    result: location?.result || null,
    verified: Boolean(location?.ok),
  };
}

function checkInLocationValues(location: LocationValidationResult, officeLocationId?: string | null) {
  return {
    checkInAccuracyMeters: location.accuracy == null ? null : location.accuracy.toString(),
    checkInDistanceMeters: location.distanceMeters == null ? null : location.distanceMeters.toString(),
    checkInLatitude: location.latitude == null ? null : location.latitude.toString(),
    checkInLocationAt: location.locationAt,
    checkInLocationVerified: location.ok,
    checkInLongitude: location.longitude == null ? null : location.longitude.toString(),
    checkInOfficeLocationId: officeLocationId || null,
    checkInVerificationResult: location.result,
  };
}

function signOutLocationValues(location: LocationValidationResult, officeLocationId?: string | null) {
  return {
    signOutAccuracyMeters: location.accuracy == null ? null : location.accuracy.toString(),
    signOutDistanceMeters: location.distanceMeters == null ? null : location.distanceMeters.toString(),
    signOutLatitude: location.latitude == null ? null : location.latitude.toString(),
    signOutLocationAt: location.locationAt,
    signOutLocationVerified: location.ok,
    signOutLongitude: location.longitude == null ? null : location.longitude.toString(),
    signOutOfficeLocationId: officeLocationId || null,
    signOutVerificationResult: location.result,
  };
}

function serializeLocationPolicy(location: typeof officeLocationTable.$inferSelect | null | undefined) {
  return location
    ? {
        formattedAddress: location.formattedAddress,
        id: location.id,
        latitude: location.latitude,
        locationKind: location.locationKind,
        longitude: location.longitude,
        maxAccuracyMeters: location.maxAccuracyMeters,
        name: location.name,
        radiusMeters: location.radiusMeters,
        scheduleEndDate: location.scheduleEndDate,
        scheduleStartDate: location.scheduleStartDate,
      }
    : null;
}

async function resolveMemberForAttendance(input: {
  actorEmail: string;
  actorId: string;
  candidateEmails?: string[];
  fullName: string | null;
}) {
  const candidateEmails = Array.from(new Set([
    input.actorEmail,
    ...(input.candidateEmails || []),
  ].filter((email) => email && email !== 'unknown')));

  for (const email of candidateEmails) {
    const resolved = await getOrAutoLinkStaffByEmail({
      email,
      fullName: input.fullName,
    });

    if (!resolved.member) continue;

    if (resolved.autoLinked && resolved.before) {
      await writeAuditEvent({
        entityType: 'staff',
        entityId: resolved.member.id,
        action: 'UPDATE',
        before: resolved.before,
        after: {
          ...resolved.member,
          autoLinkedFromAttendance: true,
          matchedLoginEmail: email,
        },
        actor: { email: input.actorEmail, id: input.actorId },
        reason: 'attendance-auto-link',
      });

      await syncStaffEmailIdentity({
        actorUserId: input.actorId,
        email,
        staffId: resolved.member.id,
        staffName: resolved.member.fullName,
      });
    }

    return resolved.member;
  }

  return null;
}

function responsePayload(input: {
  attendance?: typeof attendanceRecord.$inferSelect | null;
  currentIp: string;
  currentIpSource?: string;
  date: string;
  holidayName?: string | null;
  isHoliday: boolean;
  isAfterWorkdayEnd: boolean;
  isWeekend: boolean;
  locationConfigured: boolean;
  locationPolicy?: {
    formattedAddress?: string | null;
    id?: string;
    latitude: string;
    locationKind?: string | null;
    longitude: string;
    maxAccuracyMeters: number;
    name?: string;
    radiusMeters: number;
    scheduleEndDate?: string | null;
    scheduleStartDate?: string | null;
  } | null;
  networkConfigured: boolean;
  device?: {
    autoCheckInEnabled?: boolean;
    autoSignOutEnabled?: boolean;
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
  transferRequest?: {
    id: string;
    requestedAt?: Date | string | null;
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
    isOfficeNetwork: false,
    isWeekend: input.isWeekend,
    locationConfigured: input.locationConfigured,
    locationPolicy: input.locationPolicy || null,
    networkConfigured: input.networkConfigured,
    officeCodeRequired: false,
    permission: input.permission || null,
    transferRequest: input.transferRequest || null,
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
  autoCheckInEnabled?: boolean | null;
  autoSignOutEnabled?: boolean | null;
  deviceHash?: string;
  id?: string;
  lastSeenAt?: Date | string | null;
  registeredAt?: Date | string | null;
} | null | undefined, deviceHash: string | null) {
  return {
    autoCheckInEnabled: Boolean(device?.autoCheckInEnabled),
    autoSignOutEnabled: Boolean(device?.autoSignOutEnabled),
    lastSeenAt: device?.lastSeenAt || null,
    registered: Boolean(device),
    registeredAt: device?.registeredAt || null,
    trusted: Boolean(!device || (deviceHash && device.deviceHash === deviceHash)),
  };
}

function normalizeTimeKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const time = value.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function isLegacyEntriesFallbackSignOut(attendance: typeof attendanceRecord.$inferSelect | null | undefined) {
  return Boolean(
    attendance &&
    normalizeTimeKey(attendance.signOutTime) === '17:00' &&
    attendance.signOutNetworkIp === 'manual_admin'
  );
}

async function clearLegacyEntriesFallbackSignOut(input: {
  actor: { email: string; id?: string | null };
  attendance: typeof attendanceRecord.$inferSelect;
  date: string;
  staffName: string;
}) {
  if (!isLegacyEntriesFallbackSignOut(input.attendance)) {
    return input.attendance;
  }

  const [updatedAttendance] = await db.update(attendanceRecord)
    .set({
      signOutAccuracyMeters: null,
      signOutAt: null,
      signOutDistanceMeters: null,
      signOutLatitude: null,
      signOutLocationAt: null,
      signOutLocationVerified: false,
      signOutLongitude: null,
      signOutNetworkIp: null,
      signOutOfficeLocationId: null,
      signOutTime: null,
      signOutUserAgent: null,
      signOutVerificationResult: null,
      updatedAt: new Date(),
    })
    .where(eq(attendanceRecord.id, input.attendance.id))
    .returning();

  if (!updatedAttendance) {
    return input.attendance;
  }

  await writeAuditEvent({
    entityType: 'attendance',
    entityId: updatedAttendance.id,
    action: 'UPDATE',
    before: input.attendance,
    after: {
      ...updatedAttendance,
      repairedLegacyEntriesFallbackSignOut: true,
      staff: { fullName: input.staffName },
    },
    actor: input.actor,
    reason: 'attendance-sign-out-repair',
  });

  try {
    await syncLatenessEntriesFromAttendanceForDate(input.date);
  } catch (error) {
    console.error('Failed to sync lateness after sign-out repair:', error);
  }

  const [syncedAttendance] = await db.select()
    .from(attendanceRecord)
    .where(eq(attendanceRecord.id, updatedAttendance.id))
    .limit(1);

  publishRealtime('dashboard', 'invalidate', { reason: 'attendance-sign-out-repair' });
  publishRealtime('attendance', 'invalidate', { reason: 'attendance-sign-out-repair' });
  publishRealtime('entries', 'invalidate', { reason: 'attendance-sign-out-repair' });
  publishRealtime('payments', 'invalidate', { date: input.date, reason: 'attendance-sign-out-repair' });
  publishRealtime('staff-penalty-history', 'invalidate', { date: input.date, reason: 'attendance-sign-out-repair' });
  publishRealtime('notifications', 'invalidate', { reason: 'attendance-sign-out-repair' });

  return syncedAttendance || updatedAttendance;
}

async function readActiveOfficeLocation() {
  try {
    return await getActiveOfficeLocation();
  } catch (error) {
    console.error('Failed to read active office location; continuing without a configured location:', error);
    return null;
  }
}

async function syncDeviceBinding(input: {
  actorEmail: string;
  actorUserId: string;
  currentIp: string;
  deviceHash: string;
  deviceLabel: string;
  existingDevice?: typeof staffDevice.$inferSelect | null;
  location?: LocationValidationResult | null;
  now: Date;
  reason: string;
  staffMember: { fullName: string; id: string };
  userAgent: string | null;
}) {
  const device = input.existingDevice || await db.select()
    .from(staffDevice)
    .where(eq(staffDevice.staffId, input.staffMember.id))
    .limit(1)
    .then((rows) => rows[0] || null);

  if (device) {
    if (device.deviceHash !== input.deviceHash) {
      return { device, trusted: false };
    }

    const [updatedDevice] = await db.update(staffDevice)
      .set({
        deviceLabel: input.deviceLabel,
        lastDistanceMeters: input.location?.distanceMeters == null ? null : input.location.distanceMeters.toString(),
        lastSeenAt: input.now,
        lastSeenIp: input.currentIp,
        lastVerifiedAt: input.location?.ok ? input.now : device.lastVerifiedAt,
        lastVerificationMethod: input.location?.ok ? 'office_location' : device.lastVerificationMethod,
        updatedAt: input.now,
        userAgent: input.userAgent,
        userId: input.actorUserId,
      })
      .where(eq(staffDevice.id, device.id))
      .returning();

    return { device: updatedDevice || device, trusted: true };
  }

  const [createdDevice] = await db.insert(staffDevice)
    .values({
      deviceHash: input.deviceHash,
      deviceLabel: input.deviceLabel,
      lastDistanceMeters: input.location?.distanceMeters == null ? null : input.location.distanceMeters.toString(),
      lastSeenAt: input.now,
      lastSeenIp: input.currentIp,
      lastVerifiedAt: input.location?.ok ? input.now : null,
      lastVerificationMethod: input.location?.ok ? 'office_location' : null,
      registeredIp: input.currentIp,
      staffId: input.staffMember.id,
      updatedAt: input.now,
      userAgent: input.userAgent,
      userId: input.actorUserId,
    })
    .onConflictDoNothing({ target: staffDevice.staffId })
    .returning();

  if (createdDevice) {
    await writeAuditEvent({
      entityType: 'staff_device',
      entityId: input.staffMember.id,
      action: 'CREATE',
      before: null,
      after: {
        lastSeenIp: input.currentIp,
        location: locationForAudit(input.location),
        registeredIp: input.currentIp,
        deviceLabel: input.deviceLabel,
        staffName: input.staffMember.fullName,
        userEmail: input.actorEmail,
      },
      actor: { email: input.actorEmail, id: input.actorUserId },
      reason: input.reason,
    });

    publishRealtime('attendance', 'invalidate', { reason: input.reason });

    return { device: createdDevice, trusted: true };
  }

  const [currentDevice] = await db.select()
    .from(staffDevice)
    .where(eq(staffDevice.staffId, input.staffMember.id))
    .limit(1);

  if (!currentDevice || currentDevice.deviceHash !== input.deviceHash) {
    return { device: currentDevice || null, trusted: false };
  }

  const [updatedDevice] = await db.update(staffDevice)
    .set({
      deviceLabel: input.deviceLabel,
      lastDistanceMeters: input.location?.distanceMeters == null ? null : input.location.distanceMeters.toString(),
      lastSeenAt: input.now,
      lastSeenIp: input.currentIp,
      lastVerifiedAt: input.location?.ok ? input.now : currentDevice.lastVerifiedAt,
      lastVerificationMethod: input.location?.ok ? 'office_location' : currentDevice.lastVerificationMethod,
      updatedAt: input.now,
      userAgent: input.userAgent,
      userId: input.actorUserId,
    })
    .where(eq(staffDevice.id, currentDevice.id))
    .returning();

  return { device: updatedDevice || currentDevice, trusted: true };
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorEmails = getUserEmailAddresses(user);
    const actorEmail = actorEmails[0] || 'unknown';
    const actorFullName = getUserFullName(user);
    const clock = getAccraClock();
    const currentIpInfo = await resolveClientIpInfo(request);
    const currentIp = currentIpInfo.ip;
    const userAgent = request.headers.get('user-agent');
    const deviceToken = getDeviceTokenFromRequest(request);
    const deviceHash = deviceToken ? hashDeviceToken(deviceToken) : null;
    const [member, office, holiday] = await Promise.all([
      actorEmail === 'unknown'
        ? Promise.resolve(null)
        : resolveMemberForAttendance({
          actorEmail,
          actorId: user.id,
          candidateEmails: actorEmails,
          fullName: actorFullName,
        }),
      readActiveOfficeLocation(),
      getHolidayForDate(clock.dateKey),
    ]);
    const isWeekend = isWeekendDate(clock.dateKey);
    const permission = member
      ? await getApprovedAttendancePermission(member.id, clock.dateKey)
      : null;
    const [existingAttendanceRow] = member
      ? await db.select()
        .from(attendanceRecord)
        .where(and(eq(attendanceRecord.staffId, member.id), eq(attendanceRecord.date, clock.dateKey)))
        .limit(1)
      : [];
    let existingAttendance = existingAttendanceRow || null;
    if (member && existingAttendance) {
      existingAttendance = await clearLegacyEntriesFallbackSignOut({
        actor: { email: actorEmail, id: user.id },
        attendance: existingAttendance,
        date: clock.dateKey,
        staffName: member.fullName,
      });
    }
    const [registeredDevice] = member
      ? await db.select()
        .from(staffDevice)
        .where(eq(staffDevice.staffId, member.id))
        .limit(1)
      : [];
    const [pendingTransfer] = member
      ? await db.select()
        .from(deviceTransferRequest)
        .where(and(
          eq(deviceTransferRequest.staffId, member.id),
          eq(deviceTransferRequest.status, 'pending'),
        ))
        .orderBy(desc(deviceTransferRequest.requestedAt))
        .limit(1)
      : [];
    let resolvedDevice = registeredDevice || null;

    if (member && existingAttendance && !resolvedDevice && deviceHash) {
      const syncResult = await syncDeviceBinding({
        actorEmail,
        actorUserId: user.id,
        currentIp,
        deviceHash,
        deviceLabel: getDeviceLabel(null, userAgent),
        existingDevice: null,
        location: null,
        now: clock.now,
        reason: 'attendance-device-binding-repair',
        staffMember: { fullName: member.fullName, id: member.id },
        userAgent,
      });

      if (syncResult.trusted) {
        resolvedDevice = syncResult.device;
      }
    }

    return NextResponse.json(responsePayload({
      attendance: existingAttendance || null,
      currentIp,
      currentIpSource: currentIpInfo.source,
      date: clock.dateKey,
      device: serializeDevice(resolvedDevice, deviceHash),
      holidayName: holiday?.holidayNote || null,
      isHoliday: Boolean(holiday),
      isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
      isWeekend,
      locationConfigured: Boolean(office),
      locationPolicy: serializeLocationPolicy(office),
      networkConfigured: Boolean(office),
      permission: serializePermission(permission),
      staff: member ? { id: member.id, fullName: member.fullName, email: member.email } : null,
      time: clock.timeKey,
      transferRequest: pendingTransfer
        ? {
            id: pendingTransfer.id,
            requestedAt: pendingTransfer.requestedAt,
            status: pendingTransfer.status,
          }
        : null,
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

  const actorEmails = getUserEmailAddresses(user);
  const actorEmail = actorEmails[0] || 'unknown';
  const userId = user.id;
  const actorFullName = getUserFullName(user);
  const userAgent = request.headers.get('user-agent');
  const currentIpInfo = await resolveClientIpInfo(request);
  const currentIp = currentIpInfo.ip;
  const clock = getAccraClock();
  const checkInTime = clock.timeKey.slice(0, 5);
  const actor = await getAuditActor({ email: actorEmail, id: userId });
  const body = await request.json().catch(() => ({}));
  const attendanceSource = body?.source === 'auto_attendance'
    ? 'auto_attendance'
    : body?.source === 'mobile_app'
    ? 'mobile_app'
    : 'staff_portal';
  const action = body?.action === 'sign_out'
    ? 'sign_out'
    : body?.action === 'request_device_transfer'
    ? 'request_device_transfer'
    : 'check_in';
  const deviceToken = getDeviceTokenFromRequest(request, body);
  const deviceHash = deviceToken ? hashDeviceToken(deviceToken) : null;
  const deviceLabel = getDeviceLabel(body?.deviceLabel, userAgent);

  async function block(
    result: string,
    message: string,
    status = 400,
    staffId?: string | null,
    location?: LocationValidationResult | null,
    extra?: Record<string, unknown> & { officeLocationId?: string | null },
  ) {
    const { officeLocationId = null, ...responseExtra } = extra || {};

    await recordAttendanceAttempt({
      date: clock.dateKey,
      location: location
        ? {
            accuracy: location.accuracy,
            distanceMeters: location.distanceMeters,
            latitude: location.latitude,
            locationAt: location.locationAt,
            longitude: location.longitude,
            verificationResult: location.result,
          }
        : null,
      networkIp: currentIp,
      officeLocationId,
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
        location: locationForAudit(location),
        networkIp: currentIp,
        networkIpSource: currentIpInfo.source,
        officeLocationId,
        result,
        staffId: staffId || null,
        userEmail: actorEmail,
        ...responseExtra,
      },
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'attendance-check-in',
    });

    return NextResponse.json({ error: message, result, ...responseExtra }, { status });
  }

  try {
    if (actorEmail === 'unknown') {
      return block('NO_EMAIL', 'Your login account does not have an email address.');
    }

    const member = await resolveMemberForAttendance({
      actorEmail,
      actorId: userId,
      candidateEmails: actorEmails,
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
    let resolvedDevice = registeredDevice || null;

    const permission = await getApprovedAttendancePermission(staffMember.id, clock.dateKey);
    if (permission?.permissionType === 'absence') {
      return block(
        'PERMISSION_ABSENCE',
        'You have an approved absence for today. No check-in is required.',
        400,
        staffMember.id,
      );
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

    const officeLocation = await readActiveOfficeLocation();
    const locationValidation = validateAttendanceLocation({
      evidence: body?.location,
      now: clock.now,
      office: officeLocation
        ? {
            latitude: officeLocation.latitude,
            longitude: officeLocation.longitude,
            maxAccuracyMeters: officeLocation.maxAccuracyMeters,
            radiusMeters: officeLocation.radiusMeters,
          }
        : null,
    });

    if (!locationValidation.ok) {
      return block(
        locationValidation.result,
        locationValidation.message,
        locationValidation.result === 'OFFICE_LOCATION_NOT_CONFIGURED' ? 403 : 400,
        staffMember.id,
        locationValidation,
        { officeLocationId: officeLocation?.id },
      );
    }
    const responseLocationPolicy = serializeLocationPolicy(officeLocation);
    const officeLocationExtra = { officeLocationId: officeLocation?.id };

    if (action === 'request_device_transfer') {
      if (!registeredDevice) {
        return block(
          'DEVICE_TRANSFER_NOT_REQUIRED',
          'No trusted device is linked yet. Check in from this browser to link it.',
          400,
          staffMember.id,
          locationValidation,
          officeLocationExtra,
        );
      }

      if (registeredDevice.deviceHash === trustedDeviceHash) {
        return block(
          'DEVICE_ALREADY_TRUSTED',
          'This browser is already your trusted attendance device.',
          400,
          staffMember.id,
          locationValidation,
          officeLocationExtra,
        );
      }

      const [existingRequest] = await db.select()
        .from(deviceTransferRequest)
        .where(and(
          eq(deviceTransferRequest.staffId, staffMember.id),
          eq(deviceTransferRequest.deviceHash, trustedDeviceHash),
          eq(deviceTransferRequest.status, 'pending'),
        ))
        .orderBy(desc(deviceTransferRequest.requestedAt))
        .limit(1);
      const transferValues = {
        ...locationForDb(locationValidation),
        deviceHash: trustedDeviceHash,
        deviceLabel,
        networkIp: currentIp,
        staffId: staffMember.id,
        updatedAt: clock.now,
        userAgent,
        userEmail: actorEmail,
        userId,
      };
      const [transferRequest] = existingRequest
        ? await db.update(deviceTransferRequest)
          .set(transferValues)
          .where(eq(deviceTransferRequest.id, existingRequest.id))
          .returning()
        : await db.insert(deviceTransferRequest)
          .values(transferValues)
          .returning();

      await writeAuditEvent({
        entityType: 'staff_device_transfer',
        entityId: transferRequest.id,
        action: existingRequest ? 'UPDATE' : 'CREATE',
        before: existingRequest || null,
        after: {
          ...transferRequest,
          location: locationForAudit(locationValidation),
          staffName: staffMember.fullName,
        },
        actor: { email: actor.actorEmail, id: actor.actorUserId },
        reason: 'attendance-device-transfer-request',
      });

      publishRealtime('attendance', 'invalidate', { reason: 'attendance-device-transfer-request' });
      publishRealtime('notifications', 'invalidate', { reason: 'attendance-device-transfer-request' });

      return NextResponse.json({
        success: true,
        transferRequested: true,
        ...responsePayload({
          attendance: null,
          currentIp,
          currentIpSource: currentIpInfo.source,
          date: clock.dateKey,
          device: serializeDevice(registeredDevice, trustedDeviceHash),
          holidayName: null,
          isHoliday: false,
          isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
          isWeekend: false,
          locationConfigured: true,
          locationPolicy: responseLocationPolicy,
          networkConfigured: true,
          permission: serializePermission(permission),
          staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
          time: clock.timeKey,
          transferRequest: {
            id: transferRequest.id,
            requestedAt: transferRequest.requestedAt,
            status: transferRequest.status,
          },
        }),
      });
    }

    if (registeredDevice && registeredDevice.deviceHash !== trustedDeviceHash) {
      return block(
        'REGISTERED_DEVICE_REQUIRED',
        'This browser is not the trusted attendance device. Request a device transfer from this browser for admin approval.',
        403,
        staffMember.id,
        locationValidation,
        { ...officeLocationExtra, canRequestTransfer: true },
      );
    }

    const [existingAttendanceRow] = await db.select()
      .from(attendanceRecord)
      .where(and(eq(attendanceRecord.staffId, staffMember.id), eq(attendanceRecord.date, clock.dateKey)))
      .limit(1);
    let existingAttendance = existingAttendanceRow || null;
    if (existingAttendance) {
      existingAttendance = await clearLegacyEntriesFallbackSignOut({
        actor: { email: actor.actorEmail, id: actor.actorUserId },
        attendance: existingAttendance,
        date: clock.dateKey,
        staffName: staffMember.fullName,
      });
    }

    async function syncTrustedDevice() {
      const syncResult = await syncDeviceBinding({
        actorEmail: actor.actorEmail,
        actorUserId: userId,
        currentIp,
        deviceHash: trustedDeviceHash,
        deviceLabel,
        existingDevice: resolvedDevice,
        location: locationValidation,
        now: clock.now,
        reason: 'attendance-device-binding',
        staffMember: { fullName: staffMember.fullName, id: staffMember.id },
        userAgent,
      });

      resolvedDevice = syncResult.device;
      return syncResult.trusted;
    }

    if (existingAttendance) {
      if (action === 'sign_out') {
        if (existingAttendance.signOutTime) {
          if (!(await syncTrustedDevice())) {
            return block(
              'REGISTERED_DEVICE_REQUIRED',
              'This account is already linked to another device. Ask an admin to reset your attendance device.',
              403,
              staffMember.id,
              locationValidation,
              officeLocationExtra,
            );
          }

          return NextResponse.json({
            success: true,
            alreadySignedOut: true,
            ...responsePayload({
              attendance: existingAttendance,
              currentIp,
              currentIpSource: currentIpInfo.source,
              date: clock.dateKey,
              device: serializeDevice(resolvedDevice, trustedDeviceHash),
              holidayName: null,
              isHoliday: false,
              isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
              isWeekend: false,
              locationConfigured: true,
              locationPolicy: responseLocationPolicy,
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
            locationValidation,
            officeLocationExtra,
          );
        }

        if (!(await syncTrustedDevice())) {
          return block(
            'REGISTERED_DEVICE_REQUIRED',
            'This account is already linked to another device. Ask an admin to reset your attendance device.',
            403,
            staffMember.id,
            locationValidation,
            officeLocationExtra,
          );
        }

        const [updatedAttendance] = await db.update(attendanceRecord)
          .set({
            ...signOutLocationValues(locationValidation, officeLocation?.id),
            signOutAt: clock.now,
            signOutNetworkIp: currentIp,
            signOutTime: checkInTime,
            signOutUserAgent: userAgent,
            updatedAt: clock.now,
          })
          .where(and(eq(attendanceRecord.id, existingAttendance.id), isNull(attendanceRecord.signOutTime)))
          .returning();

        if (!updatedAttendance) {
          const [alreadySignedOutAttendance] = await db.select()
            .from(attendanceRecord)
            .where(eq(attendanceRecord.id, existingAttendance.id))
            .limit(1);

          return NextResponse.json({
            success: true,
            alreadySignedOut: true,
            ...responsePayload({
              attendance: alreadySignedOutAttendance || existingAttendance,
              currentIp,
              currentIpSource: currentIpInfo.source,
              date: clock.dateKey,
              device: serializeDevice(resolvedDevice || {
                deviceHash: trustedDeviceHash,
                lastSeenAt: clock.now,
                registeredAt: clock.now,
              }, trustedDeviceHash),
              holidayName: null,
              isHoliday: false,
              isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
              isWeekend: false,
              locationConfigured: true,
              locationPolicy: responseLocationPolicy,
              networkConfigured: true,
              permission: serializePermission(permission),
              staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
              time: clock.timeKey,
            }),
          });
        }

        await recordAttendanceAttempt({
          date: clock.dateKey,
          location: {
            accuracy: locationValidation.accuracy,
            distanceMeters: locationValidation.distanceMeters,
            latitude: locationValidation.latitude,
            locationAt: locationValidation.locationAt,
            longitude: locationValidation.longitude,
            verificationResult: locationValidation.result,
          },
          networkIp: currentIp,
          officeLocationId: officeLocation?.id,
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
            location: locationForAudit(locationValidation),
            networkIpSource: currentIpInfo.source,
            source: attendanceSource,
            staff: { fullName: staffMember.fullName },
          },
          actor: { email: actor.actorEmail, id: actor.actorUserId },
          reason: 'attendance-sign-out',
        });

        try {
          await syncLatenessEntriesFromAttendanceForDate(clock.dateKey);
        } catch (error) {
          console.error('Failed to sync lateness after sign-out:', error);
        }

        publishRealtime('dashboard', 'invalidate', { reason: 'attendance-sign-out' });
        publishRealtime('attendance', 'invalidate', { reason: 'attendance-sign-out' });
        publishRealtime('entries', 'invalidate', { reason: 'attendance-sign-out' });
        publishRealtime('payments', 'invalidate', { date: clock.dateKey, reason: 'attendance-sign-out' });
        publishRealtime('staff-penalty-history', 'invalidate', { date: clock.dateKey, reason: 'attendance-sign-out' });
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
            device: serializeDevice(resolvedDevice || {
              deviceHash: trustedDeviceHash,
              lastSeenAt: clock.now,
              registeredAt: clock.now,
            }, trustedDeviceHash),
            holidayName: null,
            isHoliday: false,
            isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
            isWeekend: false,
            locationConfigured: true,
            locationPolicy: responseLocationPolicy,
            networkConfigured: true,
            permission: serializePermission(permission),
            staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
            time: clock.timeKey,
          }),
        });
      }

      if (!(await syncTrustedDevice())) {
        return block(
          'REGISTERED_DEVICE_REQUIRED',
        'This account is already linked to another device. Ask an admin to reset your attendance device.',
        403,
        staffMember.id,
        locationValidation,
        officeLocationExtra,
      );
    }

    await recordAttendanceAttempt({
      date: clock.dateKey,
      location: {
        accuracy: locationValidation.accuracy,
        distanceMeters: locationValidation.distanceMeters,
        latitude: locationValidation.latitude,
        locationAt: locationValidation.locationAt,
        longitude: locationValidation.longitude,
        verificationResult: locationValidation.result,
      },
      networkIp: currentIp,
      officeLocationId: officeLocation?.id,
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
          device: serializeDevice(resolvedDevice, trustedDeviceHash),
          holidayName: null,
          isHoliday: false,
          isAfterWorkdayEnd: isAfterWorkdayEnd(clock.timeKey),
          isWeekend: false,
          locationConfigured: true,
          locationPolicy: responseLocationPolicy,
          networkConfigured: true,
          permission: serializePermission(permission),
          staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
          time: clock.timeKey,
        }),
      });
    }

    if (action === 'sign_out') {
      return block('CHECK_IN_REQUIRED', 'You need to check in before signing out.', 400, staffMember.id, locationValidation, officeLocationExtra);
    }

    if (isAfterWorkdayEnd(clock.timeKey)) {
      return block(
        'CHECK_IN_CLOSED',
        `Check-ins are closed after ${WORKDAY_END_LABEL}. Ask an admin to correct attendance if needed.`,
        400,
        staffMember.id,
        locationValidation,
        officeLocationExtra,
      );
    }

    if (!(await syncTrustedDevice())) {
      return block(
        'REGISTERED_DEVICE_REQUIRED',
        'This account is already linked to another device. Ask an admin to reset your attendance device.',
        403,
        staffMember.id,
        locationValidation,
        officeLocationExtra,
      );
    }

    const rawPenalty = computePenalty({
      arrivalTime: checkInTime,
      didNotSignOut: false,
      isAttendanceOnly: staffMember.isAttendanceOnly === true,
      isNssPersonnel: staffMember.isNssPersonnel === true,
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
      ...checkInLocationValues(locationValidation, officeLocation?.id),
      staffId: staffMember.id,
      date: clock.dateKey,
      checkInAt: now,
      checkInTime,
      status,
      source: attendanceSource,
      networkIp: currentIp,
      userAgent,
      computedAmount: penalty.amount.toString(),
      reason: penalty.reason || null,
      updatedAt: now,
    })
      .onConflictDoNothing({ target: [attendanceRecord.staffId, attendanceRecord.date] })
      .returning();

    if (!createdAttendance) {
      const [racedAttendance] = await db.select()
        .from(attendanceRecord)
        .where(and(eq(attendanceRecord.staffId, staffMember.id), eq(attendanceRecord.date, clock.dateKey)))
        .limit(1);

      await recordAttendanceAttempt({
        date: clock.dateKey,
        location: {
          accuracy: locationValidation.accuracy,
          distanceMeters: locationValidation.distanceMeters,
          latitude: locationValidation.latitude,
          locationAt: locationValidation.locationAt,
          longitude: locationValidation.longitude,
          verificationResult: locationValidation.result,
        },
        networkIp: currentIp,
        officeLocationId: officeLocation?.id,
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
          attendance: racedAttendance || null,
          currentIp,
          currentIpSource: currentIpInfo.source,
          date: clock.dateKey,
          device: serializeDevice(resolvedDevice || {
            deviceHash: trustedDeviceHash,
            lastSeenAt: now,
            registeredAt: now,
          }, trustedDeviceHash),
          holidayName: null,
          isHoliday: false,
          isAfterWorkdayEnd: false,
          isWeekend: false,
          locationConfigured: true,
          locationPolicy: responseLocationPolicy,
          networkConfigured: true,
          permission: serializePermission(permission),
          staff: { id: staffMember.id, fullName: staffMember.fullName, email: staffMember.email },
          time: clock.timeKey,
        }),
      });
    }

    await recordAttendanceAttempt({
      date: clock.dateKey,
      location: {
        accuracy: locationValidation.accuracy,
        distanceMeters: locationValidation.distanceMeters,
        latitude: locationValidation.latitude,
        locationAt: locationValidation.locationAt,
        longitude: locationValidation.longitude,
        verificationResult: locationValidation.result,
      },
      networkIp: currentIp,
      officeLocationId: officeLocation?.id,
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
        location: locationForAudit(locationValidation),
        networkIpSource: currentIpInfo.source,
        officeLocationStatus: 'verified',
        permission: serializePermission(permission),
        source: attendanceSource,
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
    publishRealtime('attendance', 'invalidate', { reason: 'attendance-check-in' });
    if (penalty.amount > 0) {
      publishRealtime('entries', 'invalidate', { reason: 'attendance-check-in' });
    }
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
        device: serializeDevice(resolvedDevice || {
          deviceHash: trustedDeviceHash,
          lastSeenAt: now,
          registeredAt: now,
        }, trustedDeviceHash),
        holidayName: null,
        isHoliday: false,
        isAfterWorkdayEnd: false,
        isWeekend: false,
        locationConfigured: true,
        locationPolicy: responseLocationPolicy,
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
