import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { applyNoShowSignInPenaltiesForDate } from '@/lib/attendance-lateness-sync';
import { getAccraClock } from '@/lib/attendance';
import { publishRealtime } from '@/lib/realtime';
import { REMINDER_CRON_SCHEDULES, validateReminderCronRequest } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronGuard = validateReminderCronRequest(request, REMINDER_CRON_SCHEDULES.noShowSignIn);
  if (!cronGuard.ok) return cronGuard.response;

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get('date');
  const clock = getAccraClock();
  const date = requestedDate || clock.dateKey;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (date > clock.dateKey) {
    return NextResponse.json({ error: 'Cannot apply no-show penalties for a future date' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const result = await applyNoShowSignInPenaltiesForDate(date);

  if (result.inserted > 0 || result.updated > 0 || result.deleted > 0) {
    publishRealtime('entries', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('dashboard', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('attendance', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('payments', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('staff-penalty-history', 'invalidate', { date, reason: 'no-show-sign-in' });
  }

  return NextResponse.json({ date, ...result }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}