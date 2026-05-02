import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { and, count, desc, eq, gte, ne } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, auditEvent, entrySubmission, latenessEntry, notificationRead, staff, workCalendar } from '@/db/schema';
import { getAccraClock } from '@/lib/attendance';
import { getPermissionWindowBounds, isPermissionWindowOverdue } from '@/lib/attendance-permissions';
import { getAuditActionLabel, getAuditEntityLabel, getAuditOperation } from '@/lib/audit-taxonomy';
import { tryWriteAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { NO_SIGN_OUT_ALERT_LABEL, shouldAlertNoSignOut } from '@/lib/work-hours';

export const dynamic = 'force-dynamic';

type NotificationType = 'info' | 'success' | 'warning' | 'alert';
type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
type NotificationCategory = 'audit' | 'attendance' | 'calendar' | 'exports' | 'staff' | 'system';

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: NotificationType;
  priority: NotificationPriority;
  category: NotificationCategory;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  actionLabel: string;
  actorEmail: string;
  createdAt: string;
  href: string;
}

type AuditJson = Record<string, unknown> & {
  active?: boolean;
  arrivalWindow?: string;
  computedAmount?: number | string;
  contactName?: string;
  count?: number | string;
  date?: string;
  phone?: string;
  permissionType?: string;
  expectedEndTime?: string;
  expectedStartTime?: string;
  priority?: string;
  relationship?: string;
  reason?: string;
  staffName?: string;
  fullName?: string;
  holidayNote?: string;
  month?: number | string;
  notificationIds?: string[];
  staff?: { fullName?: string };
  entryCount?: number | string;
  checkInTime?: string;
  result?: string;
  status?: string;
  submittedByEmail?: string;
  totalAdded?: number | string;
  totalSkipped?: number | string;
  totalUpdated?: number | string;
  weekEnd?: string;
  weekStart?: string;
  year?: number | string;
};

interface AuditNotificationEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  actorEmail: string | null;
  timestamp: Date | string | null;
}

type NotificationUser = {
  email: string;
  id: string;
};

const DISMISSED_PREFIX = 'dismissed:';

function toAuditJson(value: unknown): AuditJson | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AuditJson : null;
}

function getEmailFromSessionClaims(claims: Record<string, unknown> | null) {
  return [claims?.email, claims?.email_address, claims?.primary_email_address]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim() || null;
}

async function getClerkProfileEmail() {
  try {
    const user = await currentUser();
    return user?.emailAddresses[0]?.emailAddress?.trim() || null;
  } catch {
    return null;
  }
}

async function getNotificationUser(options: { resolveEmail?: boolean } = {}): Promise<NotificationUser | null> {
  const session = await auth();
  if (!session.userId) return null;
  const claims = session.sessionClaims as Record<string, unknown> | null;
  const claimEmail = getEmailFromSessionClaims(claims);
  const profileEmail = !claimEmail && options.resolveEmail ? await getClerkProfileEmail() : null;

  return {
    id: session.userId,
    email: claimEmail || profileEmail || 'unknown',
  };
}

function getNotificationHref(entityType: string) {
  switch (entityType) {
    case 'staff':
      return '/staff';
    case 'emergency_contact':
      return '/emergency-contacts';
    case 'entry':
    case 'entry_submission':
      return '/entries';
    case 'attendance':
    case 'attendance_attempt':
    case 'attendance_permission':
    case 'staff_device':
      return '/attendance';
    case 'office_network':
      return '/attendance';
    case 'calendar':
      return '/calendar';
    case 'export':
      return '/exports';
    case 'system':
      return '/dashboard';
    default:
      return '/audit-trail';
  }
}

function getCategory(entityType: string): NotificationCategory {
  switch (entityType) {
    case 'staff':
    case 'emergency_contact':
      return 'staff';
    case 'entry':
    case 'entry_submission':
    case 'attendance':
    case 'attendance_attempt':
    case 'attendance_permission':
    case 'staff_device':
      return 'attendance';
    case 'calendar':
      return 'calendar';
    case 'export':
      return 'exports';
    case 'system':
      return 'system';
    default:
      return 'audit';
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function makeNotification(
  event: AuditNotificationEvent,
  read: boolean,
  title: string,
  message: string,
  type: NotificationType,
  priority: NotificationPriority,
  overrides: Partial<Notification> = {},
): Notification {
  const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
  const operation = getAuditOperation(event.action, event.entityType, event.beforeJson, event.afterJson);

  return {
    id: event.id,
    title,
    message,
    time: getTimeAgo(timestamp),
    read,
    type,
    priority,
    category: getCategory(event.entityType),
    entityType: event.entityType,
    entityId: event.entityId,
    entityLabel: getAuditEntityLabel(event.entityType),
    action: String(operation),
    actionLabel: getAuditActionLabel(String(operation)),
    actorEmail: event.actorEmail || 'system',
    createdAt: timestamp.toISOString(),
    href: getNotificationHref(event.entityType),
    ...overrides,
  };
}

function formatNotification(event: AuditNotificationEvent, read = false): Notification {
  const afterData = toAuditJson(event.afterJson);
  const beforeData = toAuditJson(event.beforeJson);
  const operation = getAuditOperation(event.action, event.entityType, beforeData, afterData);

  switch (operation) {
    case 'CREATE':
      if (event.entityType === 'entry_submission') {
        const dateLabel = afterData?.date ? String(afterData.date) : 'the selected date';
        const entryCount = Number(afterData?.entryCount || 0);

        return makeNotification(
          event,
          read,
          'Entries submitted',
          entryCount > 0
            ? `${entryCount} lateness record${entryCount === 1 ? '' : 's'} saved for ${dateLabel}.`
            : `Daily entries for ${dateLabel} were submitted with no late arrivals.`,
          'success',
          'normal',
        );
      }

      if (event.entityType === 'staff') {
        return makeNotification(
          event,
          read,
          'Staff member added',
          `${afterData?.fullName || 'A staff member'} was added by ${event.actorEmail || 'system'}.`,
          'success',
          'normal',
        );
      }

      if (event.entityType === 'emergency_contact') {
        const contactName = afterData?.contactName || 'Emergency contact';
        const staffName = afterData?.staffName;

        return makeNotification(
          event,
          read,
          'Emergency contact added',
          staffName ? `${contactName} was linked to ${staffName}.` : `${contactName} was added.`,
          'success',
          'normal',
          { href: '/emergency-contacts' },
        );
      }

      if (event.entityType === 'entry') {
        const staffName = afterData?.staff?.fullName || afterData?.fullName || 'Staff member';
        const amount = String(afterData?.computedAmount || '0');
        const isLate = parseFloat(amount) > 0;

        return makeNotification(
          event,
          read,
          isLate ? 'Late entry recorded' : 'Attendance entry recorded',
          `${staffName} was recorded ${isLate ? `with a GHC ${amount} penalty` : 'on time'}.`,
          isLate ? 'warning' : 'info',
          isLate ? 'high' : 'normal',
        );
      }

      if (event.entityType === 'attendance') {
        const staffName = afterData?.staff?.fullName || afterData?.fullName || 'Staff member';
        const amount = parseFloat(String(afterData?.computedAmount || '0'));

        return makeNotification(
          event,
          read,
          amount > 0 ? 'Late check-in recorded' : 'Attendance check-in recorded',
          `${staffName} checked in at ${afterData?.checkInTime || 'the recorded time'}${amount > 0 ? ` with a GHC ${amount.toFixed(2)} penalty` : ''}.`,
          amount > 0 ? 'warning' : 'success',
          amount > 0 ? 'high' : 'normal',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'attendance_permission') {
        const staffName = afterData?.staffName || 'Staff member';
        const window = getPermissionWindowBounds({
          arrivalWindow: typeof afterData?.arrivalWindow === 'string' ? afterData.arrivalWindow : null,
          expectedEndTime: typeof afterData?.expectedEndTime === 'string' ? afterData.expectedEndTime : null,
          expectedStartTime: typeof afterData?.expectedStartTime === 'string' ? afterData.expectedStartTime : null,
          permissionType: typeof afterData?.permissionType === 'string' ? afterData.permissionType : null,
        });
        return makeNotification(
          event,
          read,
          'Attendance permission approved',
          `${staffName} was approved for ${afterData?.permissionType === 'absence' ? 'excused absence' : `late arrival (${window.label})`}.`,
          'info',
          'normal',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'staff_device') {
        return makeNotification(
          event,
          read,
          'Attendance device linked',
          `${afterData?.staffName || 'Staff member'} linked a check-in device.`,
          'success',
          'normal',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'calendar') {
        return makeNotification(
          event,
          read,
          'Holiday added',
          `${afterData?.holidayNote || 'Holiday'} was marked for ${afterData?.date || 'the selected date'}.`,
          'info',
          'normal',
        );
      }

      if (event.entityType === 'office_network') {
        return makeNotification(
          event,
          read,
          'Office network updated',
          'The office WiFi verification network was updated.',
          'info',
          'normal',
          { href: '/attendance' },
        );
      }

      return makeNotification(event, read, 'Record created', `Created ${getAuditEntityLabel(event.entityType)}.`, 'info', 'normal');

    case 'ACTIVATE':
    case 'DEACTIVATE': {
      const activated = operation === 'ACTIVATE';
      const name = afterData?.fullName || beforeData?.fullName || 'Staff member';

      return makeNotification(
        event,
        read,
        activated ? 'Staff member activated' : 'Staff member deactivated',
        `${name} was ${activated ? 'activated' : 'deactivated'} by ${event.actorEmail || 'system'}.`,
        activated ? 'success' : 'warning',
        activated ? 'normal' : 'high',
      );
    }

    case 'UPDATE':
      if (event.entityType === 'entry_submission') {
        const dateLabel = afterData?.date ? String(afterData.date) : 'the selected date';
        const entryCount = Number(afterData?.entryCount || 0);

        return makeNotification(
          event,
          read,
          'Entries updated',
          entryCount > 0
            ? `${entryCount} lateness record${entryCount === 1 ? '' : 's'} saved for ${dateLabel}.`
            : `Daily entries for ${dateLabel} were updated with no late arrivals.`,
          'success',
          'normal',
        );
      }

      if (event.entityType === 'staff') {
        const name = afterData?.fullName || beforeData?.fullName || 'Staff member';
        const changes: string[] = [];
        if (beforeData?.fullName !== afterData?.fullName) changes.push('name');
        if (beforeData?.department !== afterData?.department) changes.push('department');
        if (beforeData?.unit !== afterData?.unit) changes.push('unit');

        return makeNotification(
          event,
          read,
          'Staff profile updated',
          `${name}${changes.length > 0 ? ` had ${changes.join(', ')} updated` : ' was updated'}.`,
          'info',
          'normal',
        );
      }

      if (event.entityType === 'emergency_contact') {
        const name = afterData?.contactName || beforeData?.contactName || 'Emergency contact';
        return makeNotification(
          event,
          read,
          'Emergency contact updated',
          `${name} was updated.`,
          'info',
          'normal',
          { href: '/emergency-contacts' },
        );
      }

      if (event.entityType === 'entry') {
        const staffName = afterData?.staff?.fullName || afterData?.fullName || 'Staff member';
        return makeNotification(event, read, 'Attendance entry updated', `${staffName}'s entry was modified.`, 'info', 'normal');
      }

      if (event.entityType === 'attendance' && afterData?.signOutTime) {
        const staffName = afterData?.staff?.fullName || afterData?.staffName || 'Staff member';
        return makeNotification(
          event,
          read,
          'Attendance sign-out recorded',
          `${staffName} signed out at ${afterData.signOutTime}.`,
          'success',
          'normal',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'calendar') {
        return makeNotification(
          event,
          read,
          'Calendar updated',
          `Calendar entry for ${afterData?.date || 'the selected date'} was modified.`,
          'info',
          'normal',
        );
      }

      if (event.entityType === 'attendance_permission') {
        return makeNotification(
          event,
          read,
          'Attendance permission updated',
          `${afterData?.staffName || beforeData?.staffName || 'Staff member'} permission was updated.`,
          'info',
          'normal',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'staff_device') {
        return makeNotification(
          event,
          read,
          'Attendance device reset',
          `${beforeData?.staffName || afterData?.staffName || 'Staff member'} can link a new check-in device.`,
          'warning',
          'high',
          { href: '/attendance' },
        );
      }

      return makeNotification(event, read, 'Record updated', `${getAuditEntityLabel(event.entityType)} was modified.`, 'info', 'normal');

    case 'DELETE':
      if (event.entityType === 'attendance_permission') {
        return makeNotification(
          event,
          read,
          'Attendance permission removed',
          `${beforeData?.staffName || afterData?.staffName || 'Staff member'} permission was removed.`,
          'warning',
          'high',
          { href: '/attendance' },
        );
      }

      if (event.entityType === 'emergency_contact') {
        const name = beforeData?.contactName || afterData?.contactName || 'Emergency contact';
        return makeNotification(
          event,
          read,
          'Emergency contact removed',
          `${name} was removed.`,
          'warning',
          'high',
          { href: '/emergency-contacts' },
        );
      }

      return makeNotification(event, read, 'Record removed', `${getAuditEntityLabel(event.entityType)} was removed.`, 'warning', 'high');

    case 'GENERATE':
      return makeNotification(
        event,
        read,
        'Export generated',
        afterData?.weekStart
          ? `Weekly export generated for ${afterData.weekStart} to ${afterData.weekEnd || '?'}.`
          : `Monthly export generated${afterData?.year ? ` for ${afterData.year}-${afterData.month || ''}` : ''}.`,
        'success',
        'normal',
      );

    case 'SYNC':
      return makeNotification(
        event,
        read,
        'Holiday calendar synced',
        `${afterData?.totalAdded || 0} added, ${afterData?.totalUpdated || 0} updated, ${afterData?.totalSkipped || 0} skipped.`,
        'info',
        'normal',
      );

    default:
      if (operation === 'ALERT' && event.entityType === 'attendance_attempt') {
        return makeNotification(
          event,
          read,
          'Blocked attendance check-in',
          `${afterData?.userEmail || 'A user'} could not check in: ${String(afterData?.result || 'review required').replace(/_/g, ' ').toLowerCase()}.`,
          'alert',
          'high',
          { href: '/attendance' },
        );
      }

      if (operation === 'ALERT' && event.entityType === 'attendance') {
        return makeNotification(
          event,
          read,
          'Attendance needs review',
          `${afterData?.staffName || 'Staff member'} has an attendance item that needs review.`,
          'alert',
          'high',
          { href: '/attendance' },
        );
      }

      return makeNotification(
        event,
        read,
        'System event',
        `${getAuditActionLabel(String(operation))} ${getAuditEntityLabel(event.entityType)}.`,
        'info',
        'low',
      );
  }
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 250);
}

async function persistNotificationIds(userId: string, ids: string[]) {
  if (ids.length === 0) return;

  await db.insert(notificationRead)
    .values(ids.map((notificationId) => ({ notificationId, userId })))
    .onConflictDoNothing();
}

async function getNotificationState(userId: string) {
  const rows = await db.select({ notificationId: notificationRead.notificationId })
    .from(notificationRead)
    .where(eq(notificationRead.userId, userId));

  const readIds = new Set<string>();
  const dismissedIds = new Set<string>();

  for (const row of rows) {
    if (row.notificationId.startsWith(DISMISSED_PREFIX)) {
      dismissedIds.add(row.notificationId.slice(DISMISSED_PREFIX.length));
    } else {
      readIds.add(row.notificationId);
    }
  }

  return { dismissedIds, readIds };
}

async function getAuditNotifications(limit: number, readIds: Set<string>) {
  const since = subDays(new Date(), 30);

  const events = await db.select({
    id: auditEvent.id,
    entityType: auditEvent.entityType,
    entityId: auditEvent.entityId,
    action: auditEvent.action,
    beforeJson: auditEvent.beforeJson,
    afterJson: auditEvent.afterJson,
    actorEmail: auditEvent.actorEmail,
    timestamp: auditEvent.timestamp,
  })
    .from(auditEvent)
    .where(and(gte(auditEvent.timestamp, since), ne(auditEvent.entityType, 'notification')))
    .orderBy(desc(auditEvent.timestamp))
    .limit(limit);

  return events.map((event) => formatNotification(event, readIds.has(event.id)));
}

async function getSystemNotifications(readIds: Set<string>): Promise<Notification[]> {
  const today = new Date();
  const clock = getAccraClock(today);
  const todayStr = clock.dateKey;
  const dayOfWeek = new Date(`${todayStr}T00:00:00Z`).getUTCDay();
  const currentHour = Number(clock.timeKey.slice(0, 2));
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const notifications: Notification[] = [];

  const [holidayCheck] = await db.select({
    id: workCalendar.id,
    holidayNote: workCalendar.holidayNote,
  })
    .from(workCalendar)
    .where(and(eq(workCalendar.date, todayStr), eq(workCalendar.isHoliday, true)))
    .limit(1);

  if (holidayCheck) {
    notifications.push(makeNotification(
      {
        id: `system-holiday-today-${todayStr}`,
        entityType: 'calendar',
        entityId: holidayCheck.id,
        action: 'ALERT',
        beforeJson: null,
        afterJson: { date: todayStr, holidayNote: holidayCheck.holidayNote },
        actorEmail: 'system',
        timestamp: today,
      },
      readIds.has(`system-holiday-today-${todayStr}`),
      'Today is marked as a holiday',
      `${holidayCheck.holidayNote || 'Holiday'} is marked as a non-working day.`,
      'info',
      'normal',
      {
        category: 'calendar',
        href: '/calendar',
      },
    ));
  }

  const staffCountResult = await db.select({ count: count() })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)));
  const activeStaffCount = Number(staffCountResult[0]?.count || 0);

  if (isWeekday && !holidayCheck && activeStaffCount > 0) {
    const attendanceRows = await db.select({
      id: attendanceRecord.id,
      signOutTime: attendanceRecord.signOutTime,
      staffId: attendanceRecord.staffId,
      staffName: staff.fullName,
    })
      .from(attendanceRecord)
      .leftJoin(staff, eq(attendanceRecord.staffId, staff.id))
      .where(eq(attendanceRecord.date, todayStr));
    const checkedInStaffIds = new Set(attendanceRows.map((row) => row.staffId));
    const checkedInCount = attendanceRows.length;

    const latePermissions = await db.select({
      arrivalWindow: attendancePermission.arrivalWindow,
      expectedEndTime: attendancePermission.expectedEndTime,
      expectedStartTime: attendancePermission.expectedStartTime,
      id: attendancePermission.id,
      permissionType: attendancePermission.permissionType,
      reason: attendancePermission.reason,
      staffId: attendancePermission.staffId,
      staffName: staff.fullName,
    })
      .from(attendancePermission)
      .leftJoin(staff, eq(attendancePermission.staffId, staff.id))
      .where(and(
        eq(attendancePermission.date, todayStr),
        eq(attendancePermission.status, 'approved'),
        eq(attendancePermission.permissionType, 'late_arrival'),
      ));

    for (const permission of latePermissions) {
      if (checkedInStaffIds.has(permission.staffId)) continue;
      if (!isPermissionWindowOverdue(permission, todayStr, clock.dateKey, clock.timeKey)) continue;

      const window = getPermissionWindowBounds(permission);
      const alertId = `system-late-permission-overdue-${todayStr}-${permission.id}`;
      notifications.push(makeNotification(
        {
          id: alertId,
          entityType: 'attendance_permission',
          entityId: permission.id,
          action: 'ALERT',
          beforeJson: null,
          afterJson: {
            arrivalWindow: permission.arrivalWindow,
            date: todayStr,
            expectedEndTime: permission.expectedEndTime,
            expectedStartTime: permission.expectedStartTime,
            permissionType: permission.permissionType,
            reason: permission.reason,
            staffName: permission.staffName,
          },
          actorEmail: 'system',
          timestamp: today,
        },
        readIds.has(alertId),
        'Late permission overdue',
        `${permission.staffName || 'Staff member'} was approved for ${window.label.toLowerCase()} but has not checked in.`,
        'alert',
        'critical',
        {
          category: 'attendance',
          href: '/attendance',
        },
      ));
    }

    if (currentHour >= 10) {
      const [submission] = await db.select({ id: entrySubmission.id })
        .from(entrySubmission)
        .where(eq(entrySubmission.date, todayStr))
        .limit(1);

      if (!submission) {
        const alertId = `system-no-entries-${todayStr}`;
        notifications.push(makeNotification(
          {
            id: alertId,
            entityType: 'system',
            entityId: 'today-entries',
            action: 'ALERT',
            beforeJson: null,
            afterJson: { date: todayStr },
            actorEmail: 'system',
            timestamp: today,
          },
          readIds.has(alertId),
          'Entries not recorded',
          "Today's lateness entries have not been submitted yet.",
          'alert',
          'critical',
          {
            category: 'attendance',
            href: '/entries',
          },
        ));
      }

      if (checkedInCount < activeStaffCount) {
        const alertId = `system-attendance-missing-${todayStr}`;
        notifications.push(makeNotification(
          {
            id: alertId,
            entityType: 'system',
            entityId: 'today-attendance',
            action: 'ALERT',
            beforeJson: null,
            afterJson: { date: todayStr, checkedInCount, activeStaffCount },
            actorEmail: 'system',
            timestamp: today,
          },
          readIds.has(alertId),
          'Attendance check-ins incomplete',
          `${activeStaffCount - checkedInCount} active staff member${activeStaffCount - checkedInCount === 1 ? '' : 's'} have not checked in today.`,
          'alert',
          'high',
          {
            category: 'attendance',
            href: '/attendance',
          },
        ));
      }

      if (shouldAlertNoSignOut(clock.timeKey)) {
        const noSignOutRows = attendanceRows.filter((row) => !row.signOutTime);
        for (const row of noSignOutRows) {
          const alertId = `system-no-sign-out-${todayStr}-${row.staffId}`;
          notifications.push(makeNotification(
            {
              id: alertId,
              entityType: 'attendance',
              entityId: row.id,
              action: 'ALERT',
              beforeJson: null,
              afterJson: {
                date: todayStr,
                staffName: row.staffName,
              },
              actorEmail: 'system',
              timestamp: today,
            },
            readIds.has(alertId),
            'Sign-out missing',
            `${row.staffName || 'Staff member'} has not signed out by ${NO_SIGN_OUT_ALERT_LABEL}.`,
            'alert',
            'high',
            {
              category: 'attendance',
              href: '/attendance',
            },
          ));
        }
      }
    }
  }

  const weekStart = format(subDays(today, dayOfWeek === 0 ? 6 : dayOfWeek - 1), 'yyyy-MM-dd');
  const weekEntries = await db.select({ computedAmount: latenessEntry.computedAmount })
    .from(latenessEntry)
    .where(gte(latenessEntry.date, weekStart));
  const weekTotal = weekEntries.reduce((sum, entry) => sum + parseFloat(entry.computedAmount || '0'), 0);

  if (weekTotal > 500) {
    const alertId = `system-high-penalties-${weekStart}`;
    notifications.push(makeNotification(
      {
        id: alertId,
        entityType: 'system',
        entityId: 'week-penalties',
        action: 'ALERT',
        beforeJson: null,
        afterJson: { weekStart, weekTotal },
        actorEmail: 'system',
        timestamp: today,
      },
      readIds.has(alertId),
      'High weekly penalty amount',
      `This week's penalties total GHC ${weekTotal.toLocaleString()}.`,
      'alert',
      'high',
      {
        category: 'attendance',
        href: '/dashboard',
      },
    ));
  }

  if (activeStaffCount === 0) {
    const weekSuffix = format(today, 'yyyy-ww');
    const alertId = `system-no-staff-${weekSuffix}`;
    notifications.push(makeNotification(
      {
        id: alertId,
        entityType: 'system',
        entityId: 'staff-setup',
        action: 'ALERT',
        beforeJson: null,
        afterJson: { activeStaffCount },
        actorEmail: 'system',
        timestamp: today,
      },
      readIds.has(alertId),
      'No active staff',
      'Add staff members before recording lateness entries.',
      'warning',
      'critical',
      {
        category: 'staff',
        href: '/staff',
      },
    ));
  }

  return notifications;
}

function shouldKeepStatus(notification: Notification, status: string | null) {
  if (!status || status === 'all') return true;
  if (status === 'unread') return !notification.read;
  if (status === 'action_required') return notification.priority === 'critical' || notification.type === 'alert';
  return true;
}

function priorityRank(priority: NotificationPriority) {
  switch (priority) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'normal':
      return 2;
    default:
      return 1;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getNotificationUser();
    if (!user) {
      return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '40', 10), 1), 100);
    const status = url.searchParams.get('status');
    const { dismissedIds, readIds } = await getNotificationState(user.id);

    const [auditNotifications, systemNotifications] = await Promise.all([
      getAuditNotifications(limit, readIds),
      getSystemNotifications(readIds),
    ]);

    const seen = new Set<string>();
    const notifications = [...systemNotifications, ...auditNotifications]
      .filter((notification) => {
        if (seen.has(notification.id) || dismissedIds.has(notification.id)) return false;
        seen.add(notification.id);
        return shouldKeepStatus(notification, status);
      })
      .sort((a, b) => {
        const timeDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (timeDelta !== 0) return timeDelta;
        return priorityRank(b.priority) - priorityRank(a.priority);
      })
      .slice(0, limit);

    return NextResponse.json({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
      actionRequiredCount: notifications.filter((notification) => notification.priority === 'critical' || notification.type === 'alert').length,
      totalCount: notifications.length,
      generatedAt: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getNotificationUser({ resolveEmail: true });
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const action = typeof body?.action === 'string' ? body.action : 'mark_read';
    const ids = normalizeIds(body?.ids ?? body?.readIds);

    if (ids.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    if (action === 'dismiss' || action === 'clear_all') {
      await persistNotificationIds(user.id, ids);
      await persistNotificationIds(user.id, ids.map((id) => `${DISMISSED_PREFIX}${id}`));
    } else {
      await persistNotificationIds(user.id, ids);
    }

    await tryWriteAuditEvent({
      entityType: 'notification',
      entityId: ids.length === 1 ? ids[0] : 'bulk',
      action: action === 'dismiss' || action === 'clear_all' ? 'DISMISS' : 'UPDATE',
      before: null,
      after: { action, count: ids.length, notificationIds: ids },
      actor: user,
      publish: false,
    });

    publishRealtime('notifications', 'invalidate', {
      reason: 'notification-state',
      action,
      userId: user.id,
    });

    return NextResponse.json({ success: true, count: ids.length });
  } catch (error) {
    console.error('Failed to update notification state:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
