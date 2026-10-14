import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { applyNoShowSignInPenaltiesForDate, syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { getAccraClock } from '@/lib/attendance';
import { shiftDateKey } from '@/lib/date-key';
import { publishRealtime } from '@/lib/realtime';
import { REMINDER_CRON_SCHEDULES, validateReminderCronRequest } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';

/** How many past days the 4:30 PM job re-checks, so a missed sign-out (GHC 2) is always charged. */
const RECHECK_DAYS = 7;

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
  // The past week's days get the normal rules re-applied too, so a missed sign-out is charged
  // without anyone having to open that date first.
  const recheck = await syncLatenessEntriesFromAttendanceForRange(shiftDateKey(date, -RECHECK_DAYS), shiftDateKey(date, -1));

  if ([result, recheck].some((run) => run.inserted > 0 || run.updated > 0 || run.deleted > 0)) {
    publishRealtime('entries', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('dashboard', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('attendance', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('payments', 'invalidate', { date, reason: 'no-show-sign-in' });
    publishRealtime('staff-penalty-history', 'invalidate', { date, reason: 'no-show-sign-in' });
  }

  return NextResponse.json({ date, ...result, recheck }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
