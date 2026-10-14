import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { reminderCronRun } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';
import { pushAdminAlert, sendAttendanceReminderBatch } from '@/lib/push-reminders';

// Safety net for the reminder crons. Vercel and cron-job.org normally start each batch; if
// neither has run by a few minutes after the scheduled time, the next page load (check-in or
// dashboard) starts it instead. Sends are deduped per device, so nobody is reminded twice.

type FallbackReminderType = 'sign_in' | 'sign_out';

// [start, end) in Accra minutes since midnight. Starts 5 minutes after the cron time so the
// crons get the first chance. Sign-in ends when sign-in closes (4:30 PM); sign-out runs to midnight.
const FALLBACK_WINDOWS: Record<FallbackReminderType, { end: number; label: string; start: number }> = {
  sign_in: { end: 16 * 60 + 30, label: '8:15 AM sign-in', start: 8 * 60 + 20 },
  sign_out: { end: 24 * 60, label: '4:30 PM sign-out', start: 16 * 60 + 35 },
};

const THROTTLE_MS = 5 * 60 * 1000;
const lastCheckedAt = new Map<string, number>();

function minutesFromTimeKey(timeKey: string) {
  const [hour = '0', minute = '0'] = timeKey.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function dueFallbackReminderType(timeKey: string): FallbackReminderType | null {
  const minutes = minutesFromTimeKey(timeKey);
  if (minutes >= FALLBACK_WINDOWS.sign_out.start && minutes < FALLBACK_WINDOWS.sign_out.end) return 'sign_out';
  if (minutes >= FALLBACK_WINDOWS.sign_in.start && minutes < FALLBACK_WINDOWS.sign_in.end) return 'sign_in';
  return null;
}

export async function maybeRunMissedReminderBatch(now = new Date()) {
  const clock = getAccraClock(now);
  const reminderType = dueFallbackReminderType(clock.timeKey);
  if (!reminderType || isWeekendDate(clock.dateKey)) return null;

  const throttleKey = `${clock.dateKey}:${reminderType}`;
  const last = lastCheckedAt.get(throttleKey);
  if (last && now.getTime() - last < THROTTLE_MS) return null;
  lastCheckedAt.set(throttleKey, now.getTime());

  try {
    if (await getHolidayForDate(clock.dateKey)) return null;

    const [existingRun] = await db.select({ id: reminderCronRun.id })
      .from(reminderCronRun)
      .where(and(eq(reminderCronRun.date, clock.dateKey), eq(reminderCronRun.reminderType, reminderType)))
      .limit(1);
    if (existingRun) return null;

    const summary = await sendAttendanceReminderBatch(reminderType, 'app');
    await pushAdminAlert({
      alertType: `missed_${reminderType}`,
      body: `The ${FALLBACK_WINDOWS[reminderType].label} reminder job didn't run on schedule, so LateWatch sent it from the app (${summary.sent} sent). Check the cron jobs.`,
      date: clock.dateKey,
    });
    return summary;
  } catch (error) {
    console.error('Reminder fallback failed:', error);
    return null;
  }
}

// For the admin dashboard: reminder jobs the crons skipped today (a run started by the app
// itself does not count, so the warning stays up until the crons are fixed).
export async function getMissedReminderRuns(now = new Date()) {
  const clock = getAccraClock(now);
  if (isWeekendDate(clock.dateKey)) return [];
  const minutes = minutesFromTimeKey(clock.timeKey);
  const dueTypes = (Object.keys(FALLBACK_WINDOWS) as FallbackReminderType[])
    .filter((type) => minutes >= FALLBACK_WINDOWS[type].start);
  if (dueTypes.length === 0) return [];
  if (await getHolidayForDate(clock.dateKey)) return [];

  const runs = await db.select({ reminderType: reminderCronRun.reminderType, source: reminderCronRun.source })
    .from(reminderCronRun)
    .where(and(eq(reminderCronRun.date, clock.dateKey), inArray(reminderCronRun.reminderType, dueTypes)));

  return dueTypes
    .filter((type) => !runs.some((run) => run.reminderType === type && run.source !== 'app'))
    .map((type) => ({
      label: FALLBACK_WINDOWS[type].label,
      reminderType: type,
      sentByApp: runs.some((run) => run.reminderType === type && run.source === 'app'),
    }));
}
