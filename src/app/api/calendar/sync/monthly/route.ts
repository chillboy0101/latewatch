import { NextRequest, NextResponse } from 'next/server';
import { getAccraDateKey } from '@/lib/date-key';
import { syncGhanaHolidays } from '@/lib/holiday-sync';
import { validateReminderCronAuth } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Monthly holiday refresh from Google's public Ghana holiday feed, run by the Vercel cron (see
// vercel.json). Covers this year and next, so tentative dates (Eid) are corrected as they firm up.
export async function GET(request: NextRequest) {
  const guard = validateReminderCronAuth(request);
  if (!guard.ok) return guard.response;

  try {
    const year = Number(getAccraDateKey().slice(0, 4));
    const { results } = await syncGhanaHolidays({ years: [year, year + 1] });
    return NextResponse.json({
      changes: results.flatMap((result) => result.changes),
      holidaysListed: Object.fromEntries(results.map((result) => [result.year, result.holidays])),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Monthly holiday sync failed:', error);
    return NextResponse.json({ error: 'Holiday sync failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
