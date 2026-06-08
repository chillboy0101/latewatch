import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sendAttendanceReminderBatch } from '@/lib/push-reminders';
import { REMINDER_CRON_SCHEDULES, validateReminderCronRequest } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronGuard = validateReminderCronRequest(request, REMINDER_CRON_SCHEDULES.morning);
  if (!cronGuard.ok) return cronGuard.response;

  const holiday = await sendAttendanceReminderBatch('holiday');
  const signIn = holiday.isHoliday
    ? null
    : await sendAttendanceReminderBatch('sign_in');

  return NextResponse.json({
    date: holiday.date,
    holiday,
    reminderType: 'morning',
    signIn,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
