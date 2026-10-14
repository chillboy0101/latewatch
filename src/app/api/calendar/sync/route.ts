// app/api/calendar/sync/route.ts
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { syncGhanaHolidays } from '@/lib/holiday-sync';

// POST - Sync the holiday calendar now (admins; the monthly cron does the same).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const years: number[] = Array.isArray(body.years) ? body.years.map(Number) : [Number(body.year) || new Date().getFullYear()];
    const user = await currentUser();
    const { results } = await syncGhanaHolidays({
      actorEmail: user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || undefined,
      years: years.filter((year) => Number.isInteger(year) && year >= 2020 && year <= 2100),
    });
    const changes = results.flatMap((result) => result.changes);

    return NextResponse.json({
      success: true,
      message: `${changes.length} change${changes.length === 1 ? '' : 's'} across ${results.length} year${results.length === 1 ? '' : 's'}.`,
      changes,
      years: results.map((result) => result.year),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to sync holidays:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to sync holidays'
    }, { status: 500 });
  }
}

// GET - Return sync status only
export async function GET() {
  try {
    const lastSync = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.source, 'google'),
      orderBy: (cal, { desc }) => [desc(cal.updatedAt)],
    });

    return NextResponse.json({
      lastSyncedAt: lastSync?.updatedAt?.toISOString() || null,
    });
  } catch {
    return NextResponse.json({ lastSyncedAt: null });
  }
}
