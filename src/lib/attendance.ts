import 'server-only';

import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceAttempt, attendancePermission, officeLocation, officeNetwork, staff, workCalendar } from '@/db/schema';
import { resolveOfficeLocationForDate } from '@/lib/office-location-policy';
import { normalizeStaffEmail, normalizeStaffName } from '@/lib/staff-normalize';
export { getClientIp, getClientIpInfo, resolveClientIp, resolveClientIpInfo } from '@/lib/request-ip';
export { normalizeStaffEmail, normalizeStaffName } from '@/lib/staff-normalize';

export type AccraClock = {
  dateKey: string;
  timeKey: string;
  now: Date;
};

export function getAccraClock(now = new Date()): AccraClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const valueFor = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  const hour = valueFor('hour') === '24' ? '00' : valueFor('hour');

  return {
    dateKey: `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`,
    timeKey: `${hour}:${valueFor('minute')}:${valueFor('second')}`,
    now,
  };
}

export async function getActiveOfficeNetwork() {
  const [network] = await db.select()
    .from(officeNetwork)
    .where(eq(officeNetwork.isActive, true))
    .orderBy(desc(officeNetwork.updatedAt))
    .limit(1);

  return network || null;
}

export async function getActiveOfficeLocation() {
  return getResolvedOfficeLocation(getAccraClock().dateKey);
}

export async function getOfficeLocationsForAttendance() {
  return db.select()
    .from(officeLocation)
    .where(and(
      eq(officeLocation.isActive, true),
      isNull(officeLocation.archivedAt),
    ))
    .orderBy(desc(officeLocation.updatedAt));
}

export async function getResolvedOfficeLocation(dateKey: string) {
  const locations = await getOfficeLocationsForAttendance();
  const location = resolveOfficeLocationForDate(locations, dateKey);

  return location || null;
}

export function isOfficeIp(clientIp: string, allowedIp: string | null | undefined) {
  if (!allowedIp) return false;
  return clientIp === allowedIp;
}

export async function getStaffByEmail(email: string) {
  const [member] = await db.select()
    .from(staff)
    .where(and(
      ilike(staff.email, email),
      eq(staff.active, true),
      eq(staff.archived, false),
    ))
    .limit(1);

  return member || null;
}

export async function getOrAutoLinkStaffByEmail(input: {
  email: string;
  fullName?: string | null;
}) {
  const normalizedEmail = normalizeStaffEmail(input.email);
  if (!normalizedEmail) {
    return { autoLinked: false, before: null, member: null };
  }

  const member = await getStaffByEmail(normalizedEmail);
  if (member) {
    return { autoLinked: false, before: null, member };
  }

  const normalizedName = normalizeStaffName(input.fullName);
  if (!normalizedName) {
    return { autoLinked: false, before: null, member: null };
  }

  const [existingEmailOwner] = await db.select()
    .from(staff)
    .where(ilike(staff.email, normalizedEmail))
    .limit(1);

  if (existingEmailOwner) {
    return { autoLinked: false, before: null, member: null };
  }

  const candidates = await db.select()
    .from(staff)
    .where(and(
      eq(staff.active, true),
      eq(staff.archived, false),
      or(isNull(staff.email), eq(staff.email, '')),
    ));

  const matches = candidates.filter((candidate) => normalizeStaffName(candidate.fullName) === normalizedName);
  if (matches.length !== 1) {
    return { autoLinked: false, before: null, member: null };
  }

  const before = matches[0];
  const [linkedMember] = await db.update(staff)
    .set({
      email: normalizedEmail,
      updatedAt: new Date(),
    })
    .where(eq(staff.id, before.id))
    .returning();

  return {
    autoLinked: Boolean(linkedMember),
    before,
    member: linkedMember || null,
  };
}

export async function getHolidayForDate(dateKey: string) {
  const [holiday] = await db.select({
    id: workCalendar.id,
    holidayNote: workCalendar.holidayNote,
  })
    .from(workCalendar)
    .where(and(
      eq(workCalendar.date, dateKey),
      eq(workCalendar.isHoliday, true),
      eq(workCalendar.isRemoved, false),
    ))
    .limit(1);

  return holiday || null;
}

export async function getApprovedAttendancePermission(staffId: string, dateKey: string) {
  const [permission] = await db.select()
    .from(attendancePermission)
    .where(and(
      eq(attendancePermission.staffId, staffId),
      eq(attendancePermission.date, dateKey),
      eq(attendancePermission.status, 'approved'),
    ))
    .limit(1);

  return permission || null;
}

export function isWeekendDate(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export async function recordAttendanceAttempt(input: {
  date: string;
  location?: {
    accuracy?: number | null;
    distanceMeters?: number | null;
    latitude?: number | null;
    locationAt?: Date | null;
    longitude?: number | null;
    verificationResult?: string | null;
  } | null;
  networkIp: string;
  officeLocationId?: string | null;
  result: string;
  staffId?: string | null;
  successful: boolean;
  userAgent?: string | null;
  userEmail: string;
  userId?: string | null;
}) {
  await db.insert(attendanceAttempt).values({
    date: input.date,
    accuracyMeters: input.location?.accuracy == null ? null : input.location.accuracy.toString(),
    distanceMeters: input.location?.distanceMeters == null ? null : input.location.distanceMeters.toString(),
    latitude: input.location?.latitude == null ? null : input.location.latitude.toString(),
    locationAt: input.location?.locationAt || null,
    longitude: input.location?.longitude == null ? null : input.location.longitude.toString(),
    networkIp: input.networkIp,
    officeLocationId: input.officeLocationId || null,
    result: input.result,
    staffId: input.staffId || null,
    successful: input.successful,
    userAgent: input.userAgent || null,
    userEmail: input.userEmail,
    userId: input.userId || null,
    verificationResult: input.location?.verificationResult || null,
  });
}
