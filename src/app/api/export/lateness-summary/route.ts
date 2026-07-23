import { NextRequest, NextResponse } from 'next/server';
import { and, gte, lte } from 'drizzle-orm';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { db } from '@/db';
import { latenessEntry } from '@/db/schema';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { getMonthWorkingWeeks } from '@/lib/export-weeks';
import { summarizeLatenessExportEntries } from '@/lib/lateness-export-summary';
import { enforceRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

function parseMonthParam(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const month = Number(value);

  return Number.isInteger(month) && month >= 0 && month <= 11 ? month : null;
}

function parseYearParam(value: string | null) {
  if (value === null || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);

  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function normalizeDateKey(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const url = new URL(request.url);
    const year = parseYearParam(url.searchParams.get('year'));
    const month = parseMonthParam(url.searchParams.get('month'));

    if (year === null || month === null) {
      return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
    }

    const selectedMonth = new Date(year, month, 1);
    const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd');

    await syncLatenessEntriesFromAttendanceForRange(monthStart, monthEnd);

    const entries = await db.select({
      computedAmount: latenessEntry.computedAmount,
      date: latenessEntry.date,
      didNotSignOut: latenessEntry.didNotSignOut,
      reason: latenessEntry.reason,
    })
      .from(latenessEntry)
      .where(and(gte(latenessEntry.date, monthStart), lte(latenessEntry.date, monthEnd)));

    const entriesByDate = new Map<string, typeof entries>();
    for (const entry of entries) {
      const dateKey = normalizeDateKey(entry.date);
      const dateEntries = entriesByDate.get(dateKey) || [];
      dateEntries.push(entry);
      entriesByDate.set(dateKey, dateEntries);
    }

    const weeks = getMonthWorkingWeeks(year, month).map((week) => {
      const weekEntries = week.dates.flatMap((dateKey) => entriesByDate.get(dateKey) || []);
      const weekTotals = summarizeLatenessExportEntries(weekEntries);

      return {
        ...week,
        weekLabel: `Week ${week.weekNumber}`,
        totalLateArrivals: weekTotals.lateArrivals,
        totalSignOut: weekTotals.signOut,
        totalAmount: weekTotals.amount,
      };
    });

    const totals = weeks.reduce(
      (summary, week) => ({
        amount: summary.amount + week.totalAmount,
        lateArrivals: summary.lateArrivals + week.totalLateArrivals,
        signOut: summary.signOut + week.totalSignOut,
      }),
      { amount: 0, lateArrivals: 0, signOut: 0 },
    );

    return NextResponse.json(
      { month, totals, weeks, year },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to fetch lateness export summary:', error);
    return NextResponse.json({ error: 'Failed to fetch lateness export summary' }, { status: 500 });
  }
}
