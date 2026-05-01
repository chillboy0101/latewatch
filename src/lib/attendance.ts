import 'server-only';

import { and, desc, eq, ilike } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceAttempt, officeNetwork, staff, workCalendar } from '@/db/schema';
export { getClientIp } from '@/lib/request-ip';

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

export function normalizeStaffEmail(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

export async function getActiveOfficeNetwork() {
  const [network] = await db.select()
    .from(officeNetwork)
    .where(eq(officeNetwork.isActive, true))
    .orderBy(desc(officeNetwork.updatedAt))
    .limit(1);

  return network || null;
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

export function isWeekendDate(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export async function recordAttendanceAttempt(input: {
  date: string;
  networkIp: string;
  result: string;
  staffId?: string | null;
  successful: boolean;
  userAgent?: string | null;
  userEmail: string;
  userId?: string | null;
}) {
  await db.insert(attendanceAttempt).values({
    date: input.date,
    networkIp: input.networkIp,
    result: input.result,
    staffId: input.staffId || null,
    successful: input.successful,
    userAgent: input.userAgent || null,
    userEmail: input.userEmail,
    userId: input.userId || null,
  });
}
