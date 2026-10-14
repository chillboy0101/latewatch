// app/api/dashboard/route.ts
import { after, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent, latenessEntry, staff } from '@/db/schema';
import { gt, gte, lte, and, desc, count, eq } from 'drizzle-orm';
import { getHolidayDatesForRange } from '@/lib/attendance';
import { getAuditActivityLabel, getAuditSummary, getAuditTargetName } from '@/lib/audit-display';
import { getAccraDateKey } from '@/lib/date-key';
import { getWeekBoundsForDate } from '@/lib/lateness-payments';
import { getMissedReminderRuns, maybeRunMissedReminderBatch } from '@/lib/reminder-fallback';

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  // If a reminder cron missed its slot today, send that batch after this response.
  after(() => maybeRunMissedReminderBatch());

  try {
    // Weeks run Monday to Friday in Accra time, whatever the server's clock zone.
    const today = getAccraDateKey();
    const { weekEnd: weekEndStr, weekStart: weekStartStr } = getWeekBoundsForDate(today);
    const { weekEnd: prevWeekEndStr, weekStart: prevWeekStartStr } = getWeekBoundsForDate(shiftDateKey(weekStartStr, -7));

    // Fetch current week entries - use db.select with proper where clause
    const weekEntriesResult = await db.select({
      id: latenessEntry.id,
      staffId: latenessEntry.staffId,
      date: latenessEntry.date,
      arrivalTime: latenessEntry.arrivalTime,
      didNotSignOut: latenessEntry.didNotSignOut,
      reason: latenessEntry.reason,
      computedAmount: latenessEntry.computedAmount,
      createdAt: latenessEntry.createdAt,
    })
    .from(latenessEntry)
    // Charged entries only: GHC 0 rows (waived no-shows, cleared days) aren't penalties.
    .where(and(gte(latenessEntry.date, weekStartStr), lte(latenessEntry.date, weekEndStr), gt(latenessEntry.computedAmount, '0')))
    .orderBy(desc(latenessEntry.createdAt));

    // Fetch previous week entries for comparison
    const prevWeekEntriesResult = await db.select({
      computedAmount: latenessEntry.computedAmount,
    })
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, prevWeekStartStr), lte(latenessEntry.date, prevWeekEndStr), gt(latenessEntry.computedAmount, '0')));

    // Fetch active staff count
    const staffCountResult = await db.select({ count: count() })
      .from(staff)
      .where(and(eq(staff.active, true), eq(staff.archived, false)));
    const staffCount = Number(staffCountResult[0]?.count || 0);

    // Same holiday rules as charging (removed days and observed Ghana holidays included).
    const holidayDates = await getHolidayDatesForRange(weekStartStr, weekEndStr);

    // Calculate totals
    const weekTotal = weekEntriesResult.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);
    const prevWeekTotal = prevWeekEntriesResult.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

    // One row per workday: holiday, still to come, penalties charged, or none (yet, if today).
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weekDays = dayNames.map((dayName, index) => {
      const dateStr = shiftDateKey(weekStartStr, index);
      const day = `${dayName} ${dateStr.slice(8, 10)}`;
      const dayEntries = weekEntriesResult.filter((e) => e.date === dateStr);
      const amount = dayEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);
      const status = holidayDates.has(dateStr)
        ? 'holiday'
        : dayEntries.length > 0
          ? 'penalties'
          : dateStr > today
            ? 'upcoming'
            : dateStr === today ? 'today' : 'clear';
      return { amount, day, entries: dayEntries.length, status };
    });

    // Build recent entries
    const recentEvents = await db.select({
      id: auditEvent.id,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      action: auditEvent.action,
      beforeJson: auditEvent.beforeJson,
      afterJson: auditEvent.afterJson,
      actorUserId: auditEvent.actorUserId,
      actorEmail: auditEvent.actorEmail,
      timestamp: auditEvent.timestamp,
    })
    .from(auditEvent)
    .orderBy(desc(auditEvent.timestamp))
    .limit(10);

    const recentActivity = recentEvents.map((event) => ({
      id: event.id,
      actionLabel: getAuditActivityLabel(event),
      actorEmail: event.actorEmail,
      entityId: event.entityId,
      entityLabel: getAuditTargetName(event),
      entityType: event.entityType,
      summary: getAuditSummary(event),
      timestamp: event.timestamp,
    }));

    const missedReminders = await getMissedReminderRuns().catch((error) => {
      console.error('Failed to check reminder runs:', error);
      return [];
    });

    return NextResponse.json({
      missedReminders,
      weekTotal,
      weekEntryCount: weekEntriesResult.length,
      staffCount,
      prevWeekTotal,
      prevWeekEntryCount: prevWeekEntriesResult.length,
      weekDays,
      weekEnd: weekEndStr,
      weekStart: weekStartStr,
      recentActivity,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
