// app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent, latenessEntry, staff, workCalendar } from '@/db/schema';
import { desc, count, gte, eq, and } from 'drizzle-orm';
import { format, subDays } from 'date-fns';

export const dynamic = 'force-dynamic';

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'alert';
  entityType: string;
  entityId: string;
  action: string;
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function formatNotification(event: any): Notification {
  const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
  const timeAgo = getTimeAgo(timestamp);

  const afterData = event.afterJson && typeof event.afterJson === 'object' ? event.afterJson : null;
  const beforeData = event.beforeJson && typeof event.beforeJson === 'object' ? event.beforeJson : null;

  switch (event.action) {
    case 'CREATE':
      if (event.entityType === 'staff') {
        const name = afterData?.fullName || 'Unknown';
        return {
          id: event.id, title: 'New Staff Added', message: `${name} was added to the system`,
          time: timeAgo, read: false, type: 'success', entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      if (event.entityType === 'entry') {
        const staffName = afterData?.staff?.fullName || 'Unknown';
        const amount = afterData?.computedAmount || '0';
        const isLate = parseFloat(amount) > 0;
        return {
          id: event.id,
          title: isLate ? 'Late Entry Recorded' : 'Entry Recorded',
          message: `${staffName} — ${isLate ? `GHC ${amount} penalty` : 'On time'}`,
          time: timeAgo, read: false, type: isLate ? 'warning' : 'info',
          entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      if (event.entityType === 'calendar') {
        const holidayName = afterData?.holidayNote || 'Holiday';
        return {
          id: event.id, title: 'Holiday Marked', message: `${holidayName} on ${afterData?.date || 'date'}`,
          time: timeAgo, read: false, type: 'info', entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      return {
        id: event.id, title: 'New Record Created', message: `Created ${event.entityType}`,
        time: timeAgo, read: false, type: 'info', entityType: event.entityType, entityId: event.entityId, action: event.action,
      };

    case 'UPDATE':
      if (event.entityType === 'staff') {
        const name = afterData?.fullName || beforeData?.fullName || 'Staff';
        const changes: string[] = [];
        if (beforeData?.active !== afterData?.active) {
          changes.push(afterData?.active ? 'activated' : 'deactivated');
        }
        return {
          id: event.id, title: 'Staff Updated',
          message: changes.length > 0 ? `${name} was ${changes.join(', ')}` : `${name}'s info was updated`,
          time: timeAgo, read: false, type: afterData?.active === false ? 'warning' : 'info',
          entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      if (event.entityType === 'entry') {
        const staffName = afterData?.staff?.fullName || 'Unknown';
        return {
          id: event.id, title: 'Entry Updated', message: `${staffName}'s entry was modified`,
          time: timeAgo, read: false, type: 'info', entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      return {
        id: event.id, title: 'Record Updated', message: `${event.entityType} was modified`,
        time: timeAgo, read: false, type: 'info', entityType: event.entityType, entityId: event.entityId, action: event.action,
      };

    case 'DELETE':
      if (event.entityType === 'staff') {
        return {
          id: event.id, title: 'Staff Removed', message: `${beforeData?.fullName || 'Staff member'} was removed`,
          time: timeAgo, read: false, type: 'alert', entityType: event.entityType, entityId: event.entityId, action: event.action,
        };
      }
      return {
        id: event.id, title: 'Record Deleted', message: `${event.entityType} was removed`,
        time: timeAgo, read: false, type: 'warning', entityType: event.entityType, entityId: event.entityId, action: event.action,
      };

    case 'EXPORT':
      return {
        id: event.id, title: 'Export Generated', message: `${afterData?.weekStart ? 'Weekly' : 'Monthly'} report by ${event.actorEmail || 'unknown'}`,
        time: timeAgo, read: false, type: 'success', entityType: event.entityType, entityId: event.entityId, action: event.action,
      };

    default:
      return {
        id: event.id, title: 'System Event', message: `${event.action} on ${event.entityType}`,
        time: timeAgo, read: false, type: 'info', entityType: event.entityType, entityId: event.entityId, action: event.action,
      };
  }
}

// GET - Fetch notifications with system alerts
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // Fetch recent audit events (last 7 days only for relevance)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const events = await db.select({
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
    .where(gte(auditEvent.timestamp, sevenDaysAgo))
    .orderBy(desc(auditEvent.timestamp))
    .limit(limit);

    const notifications: Notification[] = events.map(formatNotification);

    // ─── System-level alerts ──────────────────────────────────────────
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon ... 6=Sat
    const currentHour = new Date().getHours();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    // Check if today is a holiday
    let todayIsHoliday = false;
    if (isWeekday) {
      const [holidayCheck] = await db.select({ id: workCalendar.id })
        .from(workCalendar)
        .where(and(eq(workCalendar.date, todayStr), eq(workCalendar.isHoliday, true)));
      todayIsHoliday = !!holidayCheck;
    }

    // Alert: entries not recorded today (only on weekdays, after 10 AM, not a holiday)
    if (isWeekday && !todayIsHoliday && currentHour >= 10) {
      const todayEntries = await db.select({ id: latenessEntry.id })
        .from(latenessEntry)
        .where(eq(latenessEntry.date, todayStr))
        .limit(1);

      if (todayEntries.length === 0) {
        notifications.unshift({
          id: `system-no-entries-${todayStr}`,
          title: 'Entries Not Recorded',
          message: "Today's lateness entries have not been recorded yet",
          time: 'Action needed',
          read: false,
          type: 'alert',
          entityType: 'system',
          entityId: 'today-entries',
          action: 'ALERT',
        });
      }
    }

    // Alert: high penalty this week (> GHC 500)
    const weekStart = format(
      subDays(new Date(), dayOfWeek === 0 ? 6 : dayOfWeek - 1),
      'yyyy-MM-dd'
    );
    const weekEntries = await db.select({ computedAmount: latenessEntry.computedAmount })
      .from(latenessEntry)
      .where(gte(latenessEntry.date, weekStart));
    const weekTotal = weekEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

    if (weekTotal > 500) {
      notifications.unshift({
        id: `system-high-penalties-${weekStart}`,
        title: 'High Penalty Amount',
        message: `This week's penalties total GHC ${weekTotal.toLocaleString()}`,
        time: 'This week',
        read: false,
        type: 'alert',
        entityType: 'system',
        entityId: 'week-penalties',
        action: 'ALERT',
      });
    }

    // Alert: no active staff at all
    const staffCountResult = await db.select({ count: count() }).from(staff).where(eq(staff.active, true));
    const activeStaffCount = Number(staffCountResult[0]?.count || 0);

    if (activeStaffCount === 0) {
      // Use week-based suffix so this resets if dismissed before adding staff
      const weekSuffix = format(new Date(), 'yyyy-ww');
      notifications.unshift({
        id: `system-no-staff-${weekSuffix}`,
        title: 'No Active Staff',
        message: 'Add staff members before you can record lateness entries',
        time: 'Setup needed',
        read: false,
        type: 'warning',
        entityType: 'system',
        entityId: 'staff-setup',
        action: 'ALERT',
      });
    }

    // Deduplicate (keep first occurrence)
    const seen = new Set<string>();
    const deduped = notifications.filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    return NextResponse.json({
      notifications: deduped,
      unreadCount: deduped.filter((n) => !n.read).length,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }
}

// POST - Mark notifications as read (server-side acknowledgement)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { readIds } = body;
    return NextResponse.json({ success: true, readCount: readIds?.length || 0 });
  } catch (error) {
    console.error('Failed to mark notifications:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}