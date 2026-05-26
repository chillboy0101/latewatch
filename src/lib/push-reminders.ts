import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, pushReminderDelivery, pushSubscription, staff } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';

export type PushReminderType = 'sign_in' | 'sign_out';

type ReminderEligibilityInput = {
  attendance?: {
    checkInTime?: string | null;
    signOutTime?: string | null;
  } | null;
  isHoliday: boolean;
  isWeekend: boolean;
  permission?: {
    permissionType?: string | null;
  } | null;
  reminderType: PushReminderType;
  staff: {
    active?: boolean | null;
    archived?: boolean | null;
    isAttendanceOnly?: boolean | null;
  };
  subscription: {
    disabledAt?: Date | string | null;
    signInEnabled?: boolean | null;
    signOutEnabled?: boolean | null;
  };
};

let vapidConfigured = false;

function hasVapidConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
    && process.env.VAPID_SUBJECT,
  );
}

function ensureVapidConfig() {
  if (!hasVapidConfig()) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
      process.env.VAPID_PRIVATE_KEY || '',
    );
    vapidConfigured = true;
  }
  return true;
}

export function shouldSendPushReminder(input: ReminderEligibilityInput) {
  if (input.isWeekend || input.isHoliday) return false;
  if (input.staff.active !== true || input.staff.archived === true || input.staff.isAttendanceOnly === true) return false;
  if (input.subscription.disabledAt) return false;

  if (input.reminderType === 'sign_in') {
    if (input.subscription.signInEnabled !== true) return false;
    if (input.attendance?.checkInTime) return false;
    return !['absence', 'late_arrival'].includes(input.permission?.permissionType || '');
  }

  if (input.subscription.signOutEnabled !== true) return false;
  return Boolean(input.attendance?.checkInTime && !input.attendance?.signOutTime);
}

function staffFirstName(staffName: string | null | undefined) {
  const firstName = (staffName || '').trim().split(/\s+/)[0] || '';
  if (!firstName) return '';

  return firstName
    .split('-')
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join('-');
}

export function reminderCopy(reminderType: PushReminderType, staffName?: string | null) {
  const firstName = staffFirstName(staffName);
  if (reminderType === 'sign_in') {
    return {
      body: 'Please sign in for today.',
      tag: 'latewatch-sign-in-reminder',
      title: firstName ? `${firstName}, time to sign in` : 'Time to sign in',
    };
  }

  return {
    body: 'Please sign out for today.',
    tag: 'latewatch-sign-out-reminder',
    title: firstName ? `${firstName}, time to sign out` : 'Time to sign out',
  };
}

function isExpiredPushEndpoint(error: unknown) {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;

  return statusCode === 404 || statusCode === 410;
}

export async function sendAttendanceReminderBatch(reminderType: PushReminderType) {
  const clock = getAccraClock();
  const date = clock.dateKey;
  const isWeekend = isWeekendDate(date);
  const holiday = await getHolidayForDate(date);
  const isHoliday = Boolean(holiday);

  const summary = {
    configured: hasVapidConfig(),
    date,
    disabled: 0,
    failed: 0,
    isHoliday,
    isWeekend,
    reminderType,
    sent: 0,
    skipped: 0,
  };

  if (isWeekend || isHoliday) {
    return summary;
  }

  if (!ensureVapidConfig()) {
    return summary;
  }

  const subscriptionRows = await db.select({
    auth: pushSubscription.auth,
    disabledAt: pushSubscription.disabledAt,
    endpoint: pushSubscription.endpoint,
    p256dh: pushSubscription.p256dh,
    signInEnabled: pushSubscription.signInEnabled,
    signOutEnabled: pushSubscription.signOutEnabled,
    staffActive: staff.active,
    staffArchived: staff.archived,
    staffId: pushSubscription.staffId,
    staffIsAttendanceOnly: staff.isAttendanceOnly,
    staffName: staff.fullName,
    subscriptionId: pushSubscription.id,
  })
    .from(pushSubscription)
    .innerJoin(staff, eq(pushSubscription.staffId, staff.id))
    .where(and(
      isNull(pushSubscription.disabledAt),
      reminderType === 'sign_in'
        ? eq(pushSubscription.signInEnabled, true)
        : eq(pushSubscription.signOutEnabled, true),
      eq(staff.active, true),
      eq(staff.archived, false),
      eq(staff.isAttendanceOnly, false),
    ));

  if (subscriptionRows.length === 0) {
    return summary;
  }

  const staffIds = Array.from(new Set(subscriptionRows.map((row) => row.staffId)));
  const [attendanceRows, permissionRows] = await Promise.all([
    db.select()
      .from(attendanceRecord)
      .where(and(eq(attendanceRecord.date, date), inArray(attendanceRecord.staffId, staffIds))),
    db.select()
      .from(attendancePermission)
      .where(and(
        eq(attendancePermission.date, date),
        eq(attendancePermission.status, 'approved'),
        inArray(attendancePermission.staffId, staffIds),
      )),
  ]);

  const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
  const permissionByStaffId = new Map(permissionRows.map((row) => [row.staffId, row]));

  for (const row of subscriptionRows) {
    const shouldSend = shouldSendPushReminder({
      attendance: attendanceByStaffId.get(row.staffId) || null,
      isHoliday,
      isWeekend,
      permission: permissionByStaffId.get(row.staffId) || null,
      reminderType,
      staff: {
        active: row.staffActive,
        archived: row.staffArchived,
        isAttendanceOnly: row.staffIsAttendanceOnly,
      },
      subscription: row,
    });

    if (!shouldSend) {
      summary.skipped += 1;
      continue;
    }

    const [delivery] = await db.insert(pushReminderDelivery)
      .values({
        date,
        reminderType,
        staffId: row.staffId,
        status: 'pending',
        subscriptionId: row.subscriptionId,
      })
      .onConflictDoNothing({
        target: [
          pushReminderDelivery.subscriptionId,
          pushReminderDelivery.date,
          pushReminderDelivery.reminderType,
        ],
      })
      .returning();

    if (!delivery) {
      summary.skipped += 1;
      continue;
    }

    const copy = reminderCopy(reminderType, row.staffName);

    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: {
          auth: row.auth,
          p256dh: row.p256dh,
        },
      }, JSON.stringify({
        ...copy,
        data: {
          reminderType,
          url: '/check-in',
        },
        icon: '/latewatch-logo.png',
      }));

      await db.update(pushReminderDelivery)
        .set({
          sentAt: new Date(),
          status: 'sent',
        })
        .where(eq(pushReminderDelivery.id, delivery.id));
      summary.sent += 1;
    } catch (error) {
      const expiredEndpoint = isExpiredPushEndpoint(error);
      if (expiredEndpoint) {
        await db.update(pushSubscription)
          .set({
            disabledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pushSubscription.id, row.subscriptionId));
        summary.disabled += 1;
      }

      await db.update(pushReminderDelivery)
        .set({
          error: error instanceof Error ? error.message.slice(0, 500) : 'Push send failed',
          status: expiredEndpoint ? 'disabled' : 'failed',
        })
        .where(eq(pushReminderDelivery.id, delivery.id));
      summary.failed += 1;
    }
  }

  return summary;
}
