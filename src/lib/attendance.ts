import 'server-only';

import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceAttempt, attendancePermission, officeLocation, officeNetwork, staff, workCalendar } from '@/db/schema';
import { getObservedGhanaHolidayForDate, isSuppressedGhanaHolidayDate } from '@/lib/ghana-holidays';
import { resolveOfficeLocationForDate } from '@/lib/office-location-policy';
import { normalizeStaffEmail } from '@/lib/staff-normalize';
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

/**
 * The current (not archived) staff member with exactly this email address. Matched exactly on the
 * lower-cased address: no wildcards, and never by name.
 */
export async function getStaffByEmail(email: string) {
  const normalizedEmail = normalizeStaffEmail(email);
  if (!normalizedEmail) return null;

  const [member] = await db.select()
    .from(staff)
    .where(and(
      eq(sql`lower(${staff.email})`, normalizedEmail),
      eq(staff.active, true),
      eq(staff.archived, false),
    ))
    .limit(1);

  return member || null;
}

export async function getHolidayForDate(dateKey: string) {
  if (isSuppressedGhanaHolidayDate(dateKey)) {
    return null;
  }

  const [calendarDay] = await db.select({
    id: workCalendar.id,
    isHoliday: workCalendar.isHoliday,
    isRemoved: workCalendar.isRemoved,
    holidayNote: workCalendar.holidayNote,
  })
    .from(workCalendar)
    .where(eq(workCalendar.date, dateKey))
    .limit(1);

  if (calendarDay) {
    return calendarDay.isHoliday && !calendarDay.isRemoved
      ? { id: calendarDay.id, holidayNote: calendarDay.holidayNote }
      : null;
  }

  const observedHoliday = getObservedGhanaHolidayForDate(dateKey);
  return observedHoliday
    ? { id: `ghana-holiday:${observedHoliday.date}`, holidayNote: observedHoliday.name }
    : null;
}

/** Holidays between two dates (inclusive), by the same rules as getHolidayForDate, in one query. */
export async function getHolidayDatesForRange(startDate: string, endDate: string) {
  const calendarRows = await db.select({
    date: workCalendar.date,
    isHoliday: workCalendar.isHoliday,
    isRemoved: workCalendar.isRemoved,
  })
    .from(workCalendar)
    .where(and(gte(workCalendar.date, startDate), lte(workCalendar.date, endDate)));
  const calendarByDate = new Map(calendarRows.map((row) => [String(row.date).slice(0, 10), row]));
  const holidays = new Set<string>();

  for (let date = startDate; date <= endDate;) {
    const calendarDay = calendarByDate.get(date);
    const isHoliday = isSuppressedGhanaHolidayDate(date)
      ? false
      : calendarDay
        ? Boolean(calendarDay.isHoliday && !calendarDay.isRemoved)
        : Boolean(getObservedGhanaHolidayForDate(date));
    if (isHoliday) holidays.add(date);
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }

  return holidays;
}

export async function getApprovedAttendancePermission(staffId: string, dateKey: string) {
  const [permission] = await db.select()
    .from(attendancePermission)
    .where(and(
      eq(attendancePermission.staffId, staffId),
      eq(attendancePermission.date, dateKey),
      or(eq(attendancePermission.status, 'approved'), isNotNull(attendancePermission.generalPardonType)),
    ))
    .limit(1);

  return permission || null;
}

export function isWeekendDate(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Weekends and holidays are not workdays, so no attendance permission or pardon applies to them.
export async function getNonWorkdayLabel(dateKey: string) {
  if (isWeekendDate(dateKey)) return 'a weekend';
  const holiday = await getHolidayForDate(dateKey);
  return holiday ? `a holiday (${holiday.holidayNote || 'Holiday'})` : null;
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
