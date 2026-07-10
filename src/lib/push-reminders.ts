import 'server-only';

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, pushReminderDelivery, pushSubscription, reminderCronRun, staff } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';
import { publishRealtime } from '@/lib/realtime';

export type PushReminderType = 'sign_in' | 'sign_out' | 'holiday';

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

type PushReminderDeliveryRow = {
  createdAt?: Date | string | null;
  status: string;
};

type PushReminderSummary = {
  configured: boolean;
  date: string;
  disabled: number;
  failed: number;
  holidayName: string | null;
  isHoliday: boolean;
  isWeekend: boolean;
  reminderType: PushReminderType;
  sent: number;
  skipped: number;
};

let vapidConfigured = false;

const INVISIBLE_KEY_CHARS = /[\uFEFF\u200B-\u200D\u2060\s]/g;
const MIN_REMINDER_PUSH_TTL_SECONDS = 5 * 60;
const STALE_PENDING_DELIVERY_MS = 5 * 60 * 1000;

function cleanEnvValue(value: string | undefined) {
  return (value || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(INVISIBLE_KEY_CHARS, '');
}

function cleanVapidKey(value: string | undefined) {
  return cleanEnvValue(value).replace(/=+$/g, '');
}

function base64UrlDecodedLength(value: string) {
  if (!value) return 0;

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;

  try {
    return Buffer.from(padded, 'base64').length;
  } catch {
    return 0;
  }
}

function getVapidConfig() {
  const publicKey = cleanVapidKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = cleanVapidKey(process.env.VAPID_PRIVATE_KEY);

  return {
    privateKey,
    publicKey,
    subject: cleanEnvValue(process.env.VAPID_SUBJECT),
  };
}

export function getVapidPublicKey() {
  return getVapidConfig().publicKey || null;
}

export function hasVapidConfig() {
  const { privateKey, publicKey, subject } = getVapidConfig();

  return Boolean(
    publicKey
    && privateKey
    && subject
    && base64UrlDecodedLength(publicKey) === 65
    && base64UrlDecodedLength(privateKey) === 32,
  );
}

export function ensureVapidConfig() {
  if (!hasVapidConfig()) return false;

  const { privateKey, publicKey, subject } = getVapidConfig();

  if (!vapidConfigured) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch {
      vapidConfigured = false;
      return false;
    }
    vapidConfigured = true;
  }

  return true;
}

export function shouldSendPushReminder(input: ReminderEligibilityInput) {
  if (input.staff.active !== true || input.staff.archived === true || input.staff.isAttendanceOnly === true) return false;
  if (input.subscription.disabledAt) return false;

  if (input.reminderType === 'holiday') {
    if (!input.isHoliday) return false;
    return input.subscription.signInEnabled === true || input.subscription.signOutEnabled === true;
  }

  if (input.isWeekend || input.isHoliday) return false;

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

function secondsUntilAccraTime(timeKey: string, expiresAt: string) {
  const [currentHour = '0', currentMinute = '0', currentSecond = '0'] = timeKey.split(':');
  const [expiryHour = '0', expiryMinute = '0'] = expiresAt.split(':');
  const currentSeconds = Number(currentHour) * 3600 + Number(currentMinute) * 60 + Number(currentSecond);
  const expirySeconds = Number(expiryHour) * 3600 + Number(expiryMinute) * 60;

  return Math.max(MIN_REMINDER_PUSH_TTL_SECONDS, expirySeconds - currentSeconds);
}

export function reminderPushTtlSeconds(reminderType: PushReminderType, timeKey: string) {
  return secondsUntilAccraTime(timeKey, reminderType === 'sign_out' ? '23:59' : '17:00');
}

export function reminderCopy(
  reminderType: PushReminderType,
  staffName?: string | null,
  options?: { holidayName?: string | null },
) {
  const firstName = staffFirstName(staffName);
  if (reminderType === 'sign_in') {
    return {
      body: 'Please sign in for today.',
      renotify: true,
      requireInteraction: true,
      tag: 'latewatch-sign-in-reminder',
      title: firstName ? `${firstName}, time to sign in` : 'Time to sign in',
    };
  }

  if (reminderType === 'holiday') {
    const holidayName = options?.holidayName?.trim();
    return {
      body: holidayName ? `Today is ${holidayName}. No check-in is required.` : 'No check-in is required today.',
      tag: 'latewatch-holiday-reminder',
      title: firstName ? `${firstName}, no check-in required on Holidays` : 'No check-in required on Holidays',
    };
  }

  return {
    body: 'Please sign out for today.',
    renotify: true,
    requireInteraction: true,
    tag: 'latewatch-sign-out-reminder',
    title: firstName ? `${firstName}, time to sign out` : 'Time to sign out',
  };
}

export function isExpiredPushEndpoint(error: unknown) {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;

  return statusCode === 404 || statusCode === 410;
}

function isStalePendingDelivery(delivery: PushReminderDeliveryRow) {
  if (delivery.status !== 'pending') return false;

  const createdAt = delivery.createdAt instanceof Date
    ? delivery.createdAt
    : delivery.createdAt
      ? new Date(delivery.createdAt)
      : null;

  return Boolean(createdAt && Date.now() - createdAt.getTime() >= STALE_PENDING_DELIVERY_MS);
}

async function reservePushReminderDelivery(input: {
  date: string;
  reminderType: PushReminderType;
  staffId: string;
  subscriptionId: string;
}) {
  const [delivery] = await db.insert(pushReminderDelivery)
    .values({
      date: input.date,
      reminderType: input.reminderType,
      staffId: input.staffId,
      status: 'pending',
      subscriptionId: input.subscriptionId,
    })
    .onConflictDoNothing({
      target: [
        pushReminderDelivery.subscriptionId,
        pushReminderDelivery.date,
        pushReminderDelivery.reminderType,
      ],
    })
    .returning();

  if (delivery) return delivery;

  const [existingDelivery] = await db.select()
    .from(pushReminderDelivery)
    .where(and(
      eq(pushReminderDelivery.subscriptionId, input.subscriptionId),
      eq(pushReminderDelivery.date, input.date),
      eq(pushReminderDelivery.reminderType, input.reminderType),
    ))
    .limit(1);

  if (!existingDelivery || existingDelivery.status === 'sent' || existingDelivery.status === 'disabled') {
    return null;
  }

  if (existingDelivery.status === 'pending' && !isStalePendingDelivery(existingDelivery)) {
    return null;
  }

  const [retryDelivery] = await db.update(pushReminderDelivery)
    .set({
      error: null,
      status: 'pending',
    })
    .where(eq(pushReminderDelivery.id, existingDelivery.id))
    .returning();

  return retryDelivery || null;
}

async function recordReminderCronHeartbeat(summary: PushReminderSummary, source: 'vercel' | 'external') {
  await db.insert(reminderCronRun).values({
    date: summary.date,
    disabledCount: summary.disabled,
    failedCount: summary.failed,
    reminderType: summary.reminderType,
    sentCount: summary.sent,
    skippedCount: summary.skipped,
    source,
  });
}

async function finishReminderBatch(summary: PushReminderSummary, source: 'vercel' | 'external') {
  publishRealtime('attendance', 'invalidate', {
    date: summary.date,
    reason: 'push-reminder-batch',
    reminderType: summary.reminderType,
  });
  publishRealtime('notifications', 'invalidate', {
    date: summary.date,
    reason: 'push-reminder-batch',
    reminderType: summary.reminderType,
  });

  await recordReminderCronHeartbeat(summary, source);
}

export async function sendAttendanceReminderBatch(reminderType: PushReminderType, source: 'vercel' | 'external' = 'vercel') {
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
    holidayName: holiday?.holidayNote || null,
    reminderType,
    sent: 0,
    skipped: 0,
  };

  if (reminderType === 'holiday' ? !isHoliday : isWeekend || isHoliday) {
    await finishReminderBatch(summary, source);
    return summary;
  }

  if (!ensureVapidConfig()) {
    await finishReminderBatch(summary, source);
    return summary;
  }

  const subscriptionEnabledFilter = reminderType === 'holiday'
    ? or(eq(pushSubscription.signInEnabled, true), eq(pushSubscription.signOutEnabled, true))
    : reminderType === 'sign_in'
      ? eq(pushSubscription.signInEnabled, true)
      : eq(pushSubscription.signOutEnabled, true);

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
      subscriptionEnabledFilter,
      eq(staff.active, true),
      eq(staff.archived, false),
      eq(staff.isAttendanceOnly, false),
    ));

  if (subscriptionRows.length === 0) {
    await finishReminderBatch(summary, source);
    return summary;
  }

  const attendanceByStaffId = new Map<string, { checkInTime?: string | null; signOutTime?: string | null }>();
  const permissionByStaffId = new Map<string, { permissionType?: string | null }>();

  if (reminderType !== 'holiday') {
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

    attendanceRows.forEach((row) => attendanceByStaffId.set(row.staffId, row));
    permissionRows.forEach((row) => permissionByStaffId.set(row.staffId, row));
  }

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

    const delivery = await reservePushReminderDelivery({
      date,
      reminderType,
      staffId: row.staffId,
      subscriptionId: row.subscriptionId,
    });

    if (!delivery) {
      summary.skipped += 1;
      continue;
    }

    const copy = reminderCopy(reminderType, row.staffName, { holidayName: holiday?.holidayNote || null });

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
          deliveryId: delivery.id,
          reminderType,
          url: '/check-in',
        },
        icon: '/latewatch-logo.png',
      }), {
        TTL: reminderPushTtlSeconds(reminderType, clock.timeKey),
      });

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

  await finishReminderBatch(summary, source);
  return summary;
}
