import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAccraClock } from '@/lib/attendance';

const EXTERNAL_CRON_HEADER = 'x-latewatch-cron';
const EXTERNAL_CRON_HEADER_VALUE = 'external';
const EXTERNAL_REMINDER_CRON_WINDOW_MINUTES = 30;
const VERCEL_REMINDER_CRON_WINDOW_MINUTES = 60;
const VERCEL_CRON_USER_AGENT = 'vercel-cron/1.0';

export const REMINDER_CRON_SCHEDULES = {
  morning: {
    expectedSchedule: '15 8 * * *',
    scheduledHour: 8,
    scheduledMinute: 15,
  },
  signIn: {
    expectedSchedule: '15 8 * * 1-5',
    scheduledHour: 8,
    scheduledMinute: 15,
  },
  signOut: {
    expectedSchedule: '30 16 * * 1-5',
    scheduledHour: 16,
    scheduledMinute: 30,
  },
  holiday: {
    expectedSchedule: '15 8 * * *',
    scheduledHour: 8,
    scheduledMinute: 15,
  },
} as const;

type ReminderCronSchedule = {
  expectedSchedule: string;
  scheduledHour: number;
  scheduledMinute: number;
  windowMinutes?: number;
};

type ReminderCronGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function noStoreJson(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function minutesSinceMidnight(timeKey: string) {
  const [hour = '0', minute = '0'] = timeKey.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function isWithinAccraReminderCronWindow(input: {
  allowWholeScheduledHour?: boolean;
  scheduledHour: number;
  scheduledMinute: number;
  timeKey: string;
  windowMinutes?: number;
}) {
  const currentMinute = minutesSinceMidnight(input.timeKey);
  const scheduledStartMinute = input.allowWholeScheduledHour
    ? input.scheduledHour * 60
    : input.scheduledHour * 60 + input.scheduledMinute;
  const windowMinutes = input.windowMinutes ?? EXTERNAL_REMINDER_CRON_WINDOW_MINUTES;

  return currentMinute >= scheduledStartMinute && currentMinute < scheduledStartMinute + windowMinutes;
}

export function validateReminderCronRequest(
  request: Pick<NextRequest, 'headers'>,
  schedule: ReminderCronSchedule,
): ReminderCronGuardResult {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: noStoreJson({ error: 'Unauthorized' }, 401),
    };
  }

  const userAgent = request.headers.get('user-agent') ?? '';
  const isVercelCron = userAgent.includes(VERCEL_CRON_USER_AGENT);
  const isExternalCron = request.headers.get(EXTERNAL_CRON_HEADER)?.toLowerCase() === EXTERNAL_CRON_HEADER_VALUE;
  if (!isVercelCron && !isExternalCron) {
    return {
      ok: false,
      response: noStoreJson({ error: 'Invalid cron caller' }, 403),
    };
  }

  const cronScheduleHeader = request.headers.get('x-vercel-cron-schedule');
  if (cronScheduleHeader && cronScheduleHeader !== schedule.expectedSchedule) {
    return {
      ok: false,
      response: noStoreJson({ error: 'Invalid cron schedule' }, 403),
    };
  }

  const clock = getAccraClock();
  const windowMinutes = schedule.windowMinutes
    ?? (isVercelCron ? VERCEL_REMINDER_CRON_WINDOW_MINUTES : EXTERNAL_REMINDER_CRON_WINDOW_MINUTES);
  if (!isWithinAccraReminderCronWindow({
    allowWholeScheduledHour: isVercelCron,
    scheduledHour: schedule.scheduledHour,
    scheduledMinute: schedule.scheduledMinute,
    timeKey: clock.timeKey,
    windowMinutes,
  })) {
    return {
      ok: false,
      response: noStoreJson({
        error: 'Reminder cron is outside its scheduled window',
        expectedSchedule: schedule.expectedSchedule,
        skipped: true,
        timeKey: clock.timeKey,
        windowMinutes,
      }, 409),
    };
  }

  return { ok: true };
}
