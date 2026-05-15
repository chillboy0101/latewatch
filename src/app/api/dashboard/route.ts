// app/api/dashboard/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent, latenessEntry, staff, workCalendar } from '@/db/schema';
import { gte, lte, and, desc, count, eq } from 'drizzle-orm';
import { startOfWeek, addDays, subWeeks, format } from 'date-fns';
import { getAuditActivityLabel, getAuditSummary, getAuditTargetName } from '@/lib/audit-display';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';

export async function GET() {
  try {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
    const weekEnd = addDays(weekStart, 4); // Friday
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

    // Previous week for comparison
    const prevWeekStart = subWeeks(weekStart, 1);
    const prevWeekEnd = addDays(prevWeekStart, 4);
    const prevWeekStartStr = format(prevWeekStart, 'yyyy-MM-dd');
    const prevWeekEndStr = format(prevWeekEnd, 'yyyy-MM-dd');

    await syncLatenessEntriesFromAttendanceForRange(prevWeekStartStr, weekEndStr);

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
    .where(and(gte(latenessEntry.date, weekStartStr), lte(latenessEntry.date, weekEndStr)))
    .orderBy(desc(latenessEntry.createdAt));

    // Fetch previous week entries for comparison
    const prevWeekEntriesResult = await db.select({
      computedAmount: latenessEntry.computedAmount,
    })
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, prevWeekStartStr), lte(latenessEntry.date, prevWeekEndStr)));

    // Fetch active staff count
    const staffCountResult = await db.select({ count: count() })
      .from(staff)
      .where(and(eq(staff.active, true), eq(staff.archived, false)));
    const staffCount = Number(staffCountResult[0]?.count || 0);

    // Fetch holidays for this week
    const holidaysResult = await db.select({ date: workCalendar.date })
      .from(workCalendar)
      .where(and(gte(workCalendar.date, weekStartStr), lte(workCalendar.date, weekEndStr), eq(workCalendar.isHoliday, true)));
    const holidayDates = new Set(holidaysResult.map(h => h.date));

    // Calculate totals
    const weekTotal = weekEntriesResult.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);
    const prevWeekTotal = prevWeekEntriesResult.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

    // Build daily data
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weekDays = [];
    for (let i = 0; i < 5; i++) {
      const date = addDays(weekStart, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayEntries = weekEntriesResult.filter((e) => e.date === dateStr);
      const dayTotal = dayEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

      if (holidayDates.has(dateStr)) {
        weekDays.push({ day: `${dayNames[i]} ${format(date, 'dd')}`, entries: 0, amount: 0, status: 'holiday' });
      } else if (dayEntries.length > 0) {
        weekDays.push({ day: `${dayNames[i]} ${format(date, 'dd')}`, entries: dayEntries.length, amount: dayTotal, status: 'complete' });
      } else {
        weekDays.push({ day: `${dayNames[i]} ${format(date, 'dd')}`, entries: 0, amount: 0, status: 'empty' });
      }
    }

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

    return NextResponse.json({
      weekTotal,
      weekEntryCount: weekEntriesResult.length,
      staffCount,
      prevWeekTotal,
      prevWeekEntryCount: prevWeekEntriesResult.length,
      weekDays,
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
