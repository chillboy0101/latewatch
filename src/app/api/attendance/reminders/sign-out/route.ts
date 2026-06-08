import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sendAttendanceReminderBatch } from '@/lib/push-reminders';
import { REMINDER_CRON_SCHEDULES, validateReminderCronRequest } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronGuard = validateReminderCronRequest(request, REMINDER_CRON_SCHEDULES.signOut);
  if (!cronGuard.ok) return cronGuard.response;

  const result = await sendAttendanceReminderBatch('sign_out');

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
