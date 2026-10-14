import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, pushReminderDelivery, pushSubscription, reminderCronRun, staff, staffDevice } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';
import { isCronReminderRun, REMINDER_GRACE_MINUTES } from '@/lib/reminder-fallback';
import { isStaffLeaveDate } from '@/lib/staff-leave';
import { getStaffLeavePeriodsForRange } from '@/lib/staff-leave-service';

export type ReminderMonitorType = 'sign_in' | 'sign_out';
// Whether a staff member's phone can get reminders at all, regardless of today's attendance.
export type ReminderReadiness = 'failing' | 'no_device' | 'not_registered' | 'partly_off' | 'reminders_off';
export type ReminderMonitorRowStatus =
  | 'failed'
  | 'missing'
  | 'no_trusted_device'
  | 'notifications_not_registered'
  | 'pending'
  | 'reminder_off'
  | 'sent'
  | 'skipped'
  | 'waiting';

const REMINDER_TYPES: ReminderMonitorType[] = ['sign_in', 'sign_out'];

const REMINDER_SCHEDULES: Record<ReminderMonitorType, { label: string; scheduledTime: string; scheduledMinutes: number }> = {
  sign_in: {
    label: '8:15 AM Sign-In',
    scheduledMinutes: 8 * 60 + 15,
    scheduledTime: '08:15',
  },
  sign_out: {
    label: '4:30 PM Sign-Out',
    scheduledMinutes: 16 * 60 + 30,
    scheduledTime: '16:30',
  },
};

function minutesFromTimeKey(timeKey: string | null | undefined) {
  if (typeof timeKey !== 'string') return null;
  const match = timeKey.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function hasScheduledTimePassed(input: { date: string; graceMinutes?: number; reminderType: ReminderMonitorType }) {
  const clock = getAccraClock();
  if (input.date < clock.dateKey) return true;
  if (input.date > clock.dateKey) return false;

  const currentMinutes = minutesFromTimeKey(clock.timeKey);
  return currentMinutes !== null &&
    currentMinutes >= REMINDER_SCHEDULES[input.reminderType].scheduledMinutes + (input.graceMinutes || 0);
}

function isAtOrBeforeReminderSchedule(timeKey: string | null | undefined, reminderType: ReminderMonitorType) {
  const minutes = minutesFromTimeKey(timeKey);
  return minutes !== null && minutes <= REMINDER_SCHEDULES[reminderType].scheduledMinutes;
}

function isAfterReminderSchedule(timeKey: string | null | undefined, reminderType: ReminderMonitorType) {
  const minutes = minutesFromTimeKey(timeKey);
  return minutes !== null && minutes > REMINDER_SCHEDULES[reminderType].scheduledMinutes;
}

function missingDeliveryReason(input: {
  attendance: { checkInTime?: string | null; signOutTime?: string | null } | null;
  reminderType: ReminderMonitorType;
}) {
  const scheduledTime = REMINDER_SCHEDULES[input.reminderType].scheduledTime;

  if (input.reminderType === 'sign_in' && isAfterReminderSchedule(input.attendance?.checkInTime, input.reminderType)) {
    return `No delivery record; signed in after ${scheduledTime} at ${input.attendance?.checkInTime}`;
  }

  if (input.reminderType === 'sign_out' && isAfterReminderSchedule(input.attendance?.signOutTime, input.reminderType)) {
    return `No delivery record; signed out after ${scheduledTime} at ${input.attendance?.signOutTime}`;
  }

  return 'Eligible but no delivery record found';
}

function permissionLabel(permissionType: string | null | undefined) {
  if (permissionType === 'absence') return 'Approved absence permission';
  if (permissionType === 'late_arrival') return 'Approved late-arrival permission';
  return 'Approved attendance permission';
}

function latestDate(values: Array<Date | string | null | undefined>) {
  const dates = values
    .filter(Boolean)
    .map((value) => value instanceof Date ? value : new Date(String(value)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0]?.toISOString() || null;
}

function deliveryCounts(rows: Array<{ deliveredAt: Date | string | null; error: string | null; sentAt: Date | string | null; status: string }>) {
  const sent = rows.filter((row) => row.status === 'sent').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const disabled = rows.filter((row) => row.status === 'disabled').length;
  const pending = rows.filter((row) => row.status === 'pending').length;
  const delivered = rows.filter((row) => row.status === 'sent' && row.deliveredAt).length;
  const latestError = rows.find((row) => row.error)?.error || null;

  return {
    delivered,
    disabled,
    failed,
    latestDeliveredAt: latestDate(rows.map((row) => row.deliveredAt)),
    latestError,
    latestSentAt: latestDate(rows.map((row) => row.sentAt)),
    pending,
    sent,
  };
}

function statusTone(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'missing') return 'danger';
  if (status === 'pending' || status === 'waiting' || status === 'no_trusted_device' || status === 'notifications_not_registered') return 'warning';
  if (status === 'reminder_off') return 'muted';
  return 'neutral';
}

function sentReason(input: {
  attendance: { checkInTime?: string | null; signOutTime?: string | null } | null;
  delivered: number;
  reminderType: ReminderMonitorType;
  sent: number;
}) {
  const base = input.delivered > 0
    ? (input.sent === 1 ? 'Delivered to 1 device' : `Delivered to ${input.delivered} of ${input.sent} devices`)
    : (input.sent === 1 ? 'Sent to 1 device (unconfirmed)' : `Sent to ${input.sent} devices (unconfirmed)`);

  if (input.reminderType === 'sign_in' && input.attendance?.checkInTime) {
    return `${base}; signed in at ${input.attendance.checkInTime}`;
  }

  if (input.reminderType === 'sign_out' && input.attendance?.signOutTime) {
    return `${base}; signed out at ${input.attendance.signOutTime}`;
  }

  return base;
}

/**
 * One person's reminder status for one reminder today. Pure, so the rules can be tested:
 * what was sent or failed comes first, then why nothing was due, then whether the phone is set up.
 */
export function decideReminderRow(input: {
  attendance: { checkInTime?: string | null; signOutTime?: string | null } | null;
  counts: ReturnType<typeof deliveryCounts>;
  enabledSubscriptions: number;
  /** Phones that used to get reminders but were switched off by a reset, transfer or expiry. */
  hadDisabledSubscriptions: boolean;
  hasCurrentFailure: boolean;
  hasTrustedDevice: boolean;
  holidayNote?: string | null;
  isHoliday: boolean;
  isWeekend: boolean;
  /** The scheduled time plus the grace period has passed. */
  missedAfter: boolean;
  onLeave: boolean;
  permissionType?: string | null;
  reminderType: ReminderMonitorType;
  subscriptions: number;
  /** Reminders were turned on (or the phone re-registered) after today's run. */
  turnedOnAfterRun: boolean;
}): { eligible: boolean; reason: string; status: ReminderMonitorRowStatus } {
  const { attendance, counts, reminderType } = input;
  const scheduledTime = REMINDER_SCHEDULES[reminderType].scheduledTime;

  if (counts.sent > 0) {
    return { eligible: true, reason: sentReason({ attendance, delivered: counts.delivered, reminderType, sent: counts.sent }), status: 'sent' };
  }
  if (input.hasCurrentFailure) {
    return { eligible: true, reason: counts.latestError || 'Push send failed', status: 'failed' };
  }
  // The phone's push address expired during today's send, so it was switched off.
  if (counts.disabled > 0 && input.enabledSubscriptions === 0) {
    return { eligible: true, reason: 'Phone stopped accepting reminders; ask them to turn reminders on again', status: 'failed' };
  }
  if (counts.pending > 0 && input.subscriptions > 0) {
    return { eligible: true, reason: 'Delivery reserved; waiting for send result', status: 'pending' };
  }
  if (input.isWeekend) return { eligible: false, reason: 'Weekend', status: 'skipped' };
  if (input.isHoliday) {
    return { eligible: false, reason: input.holidayNote ? `Holiday: ${input.holidayNote}` : 'Holiday', status: 'skipped' };
  }
  if (input.onLeave) return { eligible: false, reason: 'On leave', status: 'skipped' };
  if (reminderType === 'sign_in' && isAtOrBeforeReminderSchedule(attendance?.checkInTime, 'sign_in')) {
    return { eligible: false, reason: `Already signed in at ${attendance?.checkInTime}`, status: 'skipped' };
  }
  if (reminderType === 'sign_in' && ['absence', 'late_arrival'].includes(input.permissionType || '')) {
    return { eligible: false, reason: permissionLabel(input.permissionType), status: 'skipped' };
  }
  if (reminderType === 'sign_out' && !isAtOrBeforeReminderSchedule(attendance?.checkInTime, 'sign_out')) {
    return {
      eligible: false,
      reason: attendance?.checkInTime
        ? `Not signed in by ${scheduledTime}; signed in at ${attendance.checkInTime}`
        : 'Not signed in yet',
      status: 'skipped',
    };
  }
  if (reminderType === 'sign_out' && isAtOrBeforeReminderSchedule(attendance?.signOutTime, 'sign_out')) {
    return { eligible: false, reason: `Already signed out at ${attendance?.signOutTime}`, status: 'skipped' };
  }
  if (!input.hasTrustedDevice) {
    return { eligible: false, reason: 'No trusted attendance device', status: 'no_trusted_device' };
  }
  if (input.subscriptions === 0) {
    return {
      eligible: false,
      reason: input.hadDisabledSubscriptions ? 'Reminders need turning on again' : 'Notifications not registered',
      status: 'notifications_not_registered',
    };
  }
  if (input.enabledSubscriptions === 0) {
    return { eligible: false, reason: reminderType === 'sign_in' ? 'Sign-in reminder off' : 'Sign-out reminder off', status: 'reminder_off' };
  }
  if (input.turnedOnAfterRun) {
    return { eligible: false, reason: "Turned on after today's reminder", status: 'skipped' };
  }
  if (input.missedAfter) {
    return { eligible: true, reason: missingDeliveryReason({ attendance, reminderType }), status: 'missing' };
  }
  return { eligible: true, reason: `Scheduled for ${scheduledTime}`, status: 'waiting' };
}

export async function getReminderDeliveryMonitor(date: string) {
  const clock = getAccraClock();
  const isWeekend = isWeekendDate(date);
  const holiday = await getHolidayForDate(date);
  const isHoliday = Boolean(holiday);

  const staffRows = await db.select({
    department: staff.department,
    email: staff.email,
    fullName: staff.fullName,
    id: staff.id,
    unit: staff.unit,
  })
    .from(staff)
    .where(and(
      eq(staff.active, true),
      eq(staff.archived, false),
    ))
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

  const staffIds = staffRows.map((row) => row.id);
  const [attendanceRows, permissionRows, subscriptionRows, deliveryRows, deviceRows] = staffIds.length
    ? await Promise.all([
        db.select({
          checkInTime: attendanceRecord.checkInTime,
          signOutTime: attendanceRecord.signOutTime,
          staffId: attendanceRecord.staffId,
        })
          .from(attendanceRecord)
          .where(and(eq(attendanceRecord.date, date), inArray(attendanceRecord.staffId, staffIds))),
        db.select({
          permissionType: attendancePermission.permissionType,
          staffId: attendancePermission.staffId,
        })
          .from(attendancePermission)
          .where(and(
            eq(attendancePermission.date, date),
            eq(attendancePermission.status, 'approved'),
            inArray(attendancePermission.staffId, staffIds),
          )),
        // Disabled ones too, to tell "never turned on" from "switched off by a reset or expiry".
        db.select({
          createdAt: pushSubscription.createdAt,
          disabledAt: pushSubscription.disabledAt,
          id: pushSubscription.id,
          signInEnabled: pushSubscription.signInEnabled,
          signOutEnabled: pushSubscription.signOutEnabled,
          staffId: pushSubscription.staffId,
          updatedAt: pushSubscription.updatedAt,
          userAgent: pushSubscription.userAgent,
        })
          .from(pushSubscription)
          .where(inArray(pushSubscription.staffId, staffIds)),
        db.select({
          createdAt: pushReminderDelivery.createdAt,
          deliveredAt: pushReminderDelivery.deliveredAt,
          error: pushReminderDelivery.error,
          reminderType: pushReminderDelivery.reminderType,
          sentAt: pushReminderDelivery.sentAt,
          staffId: pushReminderDelivery.staffId,
          status: pushReminderDelivery.status,
          subscriptionId: pushReminderDelivery.subscriptionId,
        })
          .from(pushReminderDelivery)
          .where(and(
            eq(pushReminderDelivery.date, date),
            inArray(pushReminderDelivery.staffId, staffIds),
            inArray(pushReminderDelivery.reminderType, REMINDER_TYPES),
          )),
        db.select({
          staffId: staffDevice.staffId,
        })
          .from(staffDevice)
          .where(inArray(staffDevice.staffId, staffIds)),
      ])
    : [[], [], [], [], []];

  const disabledSubscriptionStaffIds = new Set(subscriptionRows.filter((row) => row.disabledAt).map((row) => row.staffId));
  const activeSubscriptionRows = subscriptionRows.filter((row) => !row.disabledAt);
  const leavePeriods = staffIds.length
    ? await getStaffLeavePeriodsForRange({ endDate: date, staffIds, startDate: date })
    : [];
  const onLeaveStaffIds = new Set(staffIds.filter((staffId) => isStaffLeaveDate(leavePeriods, staffId, date)));

  // The last send to each active phone: if it failed, that phone is not accepting reminders.
  const activeSubscriptionIds = activeSubscriptionRows.map((row) => row.id);
  const latestDeliveryRows = activeSubscriptionIds.length
    ? await db.selectDistinctOn([pushReminderDelivery.subscriptionId], {
        status: pushReminderDelivery.status,
        subscriptionId: pushReminderDelivery.subscriptionId,
      })
        .from(pushReminderDelivery)
        .where(inArray(pushReminderDelivery.subscriptionId, activeSubscriptionIds))
        .orderBy(pushReminderDelivery.subscriptionId, desc(pushReminderDelivery.createdAt))
    : [];
  const failingSubscriptionIds = new Set(latestDeliveryRows
    .filter((row) => row.status === 'failed')
    .map((row) => row.subscriptionId));

  const cronRunRows = await db.select({
    ranAt: reminderCronRun.ranAt,
    reminderType: reminderCronRun.reminderType,
    source: reminderCronRun.source,
  })
    .from(reminderCronRun)
    .where(and(
      eq(reminderCronRun.date, date),
      inArray(reminderCronRun.reminderType, REMINDER_TYPES),
    ));

  // Any run (cron or the app's fallback) for "last ran"; only cron runs count as "the job ran",
  // the same rule as the dashboard banner.
  const lastRunAtByType = new Map<string, string>();
  const cronRanTypes = new Set<string>();
  const appRanTypes = new Set<string>();
  for (const row of cronRunRows) {
    const ranAt = row.ranAt instanceof Date ? row.ranAt : row.ranAt ? new Date(row.ranAt) : null;
    if (!ranAt || Number.isNaN(ranAt.getTime())) continue;
    (isCronReminderRun(row.source) ? cronRanTypes : appRanTypes).add(row.reminderType);
    const existing = lastRunAtByType.get(row.reminderType);
    if (!existing || ranAt.toISOString() > existing) {
      lastRunAtByType.set(row.reminderType, ranAt.toISOString());
    }
  }

  const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
  const permissionByStaffId = new Map(permissionRows.map((row) => [row.staffId, row]));
  const trustedDeviceStaffIds = new Set(deviceRows.map((row) => row.staffId));
  const subscriptionsByStaffId = new Map<string, typeof activeSubscriptionRows>();
  const deliveriesByStaffAndType = new Map<string, typeof deliveryRows>();

  for (const subscription of activeSubscriptionRows) {
    const current = subscriptionsByStaffId.get(subscription.staffId) || [];
    current.push(subscription);
    subscriptionsByStaffId.set(subscription.staffId, current);
  }

  for (const delivery of deliveryRows) {
    const key = `${delivery.staffId}:${delivery.reminderType}`;
    const current = deliveriesByStaffAndType.get(key) || [];
    current.push(delivery);
    deliveriesByStaffAndType.set(key, current);
  }

  function buildRows(reminderType: ReminderMonitorType) {
    const missedAfter = hasScheduledTimePassed({ date, graceMinutes: REMINDER_GRACE_MINUTES, reminderType });
    const lastRunAt = lastRunAtByType.get(reminderType) || null;

    return staffRows.map((member) => {
      const attendance = attendanceByStaffId.get(member.id) || null;
      const subscriptions = subscriptionsByStaffId.get(member.id) || [];
      const enabledSubscriptions = subscriptions.filter((subscription) => (
        reminderType === 'sign_in' ? subscription.signInEnabled : subscription.signOutEnabled
      ));
      const deliveries = deliveriesByStaffAndType.get(`${member.id}:${reminderType}`) || [];
      const counts = deliveryCounts(deliveries);
      const activeSubscriptionIds = new Set(subscriptions.map((subscription) => subscription.id));
      // A failure is only the *current* state if the subscription that failed is still active; a
      // failed send to a phone since reset or replaced falls through to the real device state.
      const hasCurrentFailure = deliveries.some((delivery) => delivery.status === 'failed' && activeSubscriptionIds.has(delivery.subscriptionId));
      const lastChangedAt = latestDate(enabledSubscriptions.flatMap((subscription) => [subscription.createdAt, subscription.updatedAt]));
      const { eligible, reason, status } = decideReminderRow({
        attendance,
        counts,
        enabledSubscriptions: enabledSubscriptions.length,
        hadDisabledSubscriptions: disabledSubscriptionStaffIds.has(member.id),
        hasCurrentFailure,
        hasTrustedDevice: trustedDeviceStaffIds.has(member.id),
        holidayNote: holiday?.holidayNote || null,
        isHoliday,
        isWeekend,
        missedAfter,
        onLeave: onLeaveStaffIds.has(member.id),
        permissionType: permissionByStaffId.get(member.id)?.permissionType || null,
        reminderType,
        subscriptions: subscriptions.length,
        turnedOnAfterRun: Boolean(lastRunAt && lastChangedAt && lastChangedAt > lastRunAt),
      });

      return {
        activeReminderDevices: subscriptions.length,
        delivered: counts.delivered > 0,
        delivery: counts,
        enabledReminderDevices: enabledSubscriptions.length,
        eligible,
        reason,
        reminderType,
        staff: member,
        status,
        tone: statusTone(status),
      };
    });
  }

  function buildSection(reminderType: ReminderMonitorType) {
    const rows = buildRows(reminderType);
    const scheduledPassed = hasScheduledTimePassed({ date, reminderType });
    const missedAfter = hasScheduledTimePassed({ date, graceMinutes: REMINDER_GRACE_MINUTES, reminderType });
    const lastRunAt = lastRunAtByType.get(reminderType) || null;
    const sentByApp = appRanTypes.has(reminderType);
    const summary = {
      delivered: rows.filter((row) => row.status === 'sent' && row.delivered).length,
      eligible: rows.filter((row) => row.eligible).length,
      failed: rows.filter((row) => row.status === 'failed').length,
      missing: rows.filter((row) => row.status === 'missing').length,
      noTrustedDevice: rows.filter((row) => row.status === 'no_trusted_device').length,
      notificationsNotRegistered: rows.filter((row) => row.status === 'notifications_not_registered').length,
      pending: rows.filter((row) => row.status === 'pending').length,
      reminderOff: rows.filter((row) => row.status === 'reminder_off').length,
      sent: rows.filter((row) => row.status === 'sent').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
      waiting: rows.filter((row) => row.status === 'waiting').length,
    };
    const alerts: Array<{ message: string; tone: 'danger' | 'warning' }> = [];

    // Same rule as the dashboard banner: the cron hasn't run a few minutes after its time (a run
    // the app sent itself doesn't count). No reminder is due on weekends or holidays.
    const missedRun = !isWeekend && !isHoliday && missedAfter && !cronRanTypes.has(reminderType);
    if (missedRun) {
      alerts.push({
        message: sentByApp
          ? `${REMINDER_SCHEDULES[reminderType].label} reminder job didn't run today; LateWatch sent the reminders from the app. Check the cron jobs.`
          : `${REMINDER_SCHEDULES[reminderType].label} reminder job has not run today. LateWatch sends it on the next page visit; check the cron jobs.`,
        tone: 'danger',
      });
    } else if (missedAfter && summary.eligible > 0 && summary.sent === 0) {
      alerts.push({
        message: `${REMINDER_SCHEDULES[reminderType].label} has eligible staff but zero successful sends.`,
        tone: 'danger',
      });
    }

    if (summary.failed > 0 || summary.missing > 0) {
      alerts.push({
        message: `${summary.failed + summary.missing} eligible staff need reminder delivery review.`,
        tone: 'danger',
      });
    }

    if (summary.noTrustedDevice > 0) {
      alerts.push({
        message: `${summary.noTrustedDevice} staff have no trusted attendance device.`,
        tone: 'warning',
      });
    }

    if (summary.notificationsNotRegistered > 0) {
      alerts.push({
        message: `${summary.notificationsNotRegistered} staff have a trusted device but have not registered browser notifications.`,
        tone: 'warning',
      });
    }

    if (summary.reminderOff > 0) {
      alerts.push({
        message: `${summary.reminderOff} staff have notification devices but this reminder toggle is off.`,
        tone: 'warning',
      });
    }

    return {
      alerts,
      label: REMINDER_SCHEDULES[reminderType].label,
      lastRunAt,
      missedRun,
      reminderType,
      rows,
      scheduledPassed,
      sentByApp,
      scheduledTime: REMINDER_SCHEDULES[reminderType].scheduledTime,
      summary,
    };
  }

  // Staff whose phones won't get reminders, for admins to follow up with in person (not while on leave).
  const cannotReceive = staffRows.flatMap((member) => {
    if (onLeaveStaffIds.has(member.id)) return [];
    const subscriptions = subscriptionsByStaffId.get(member.id) || [];
    const signIn = subscriptions.some((subscription) => subscription.signInEnabled);
    const signOut = subscriptions.some((subscription) => subscription.signOutEnabled);
    let status: ReminderReadiness | null = null;
    let label = '';
    if (!trustedDeviceStaffIds.has(member.id)) {
      status = 'no_device';
      label = 'No attendance phone';
    } else if (subscriptions.length === 0) {
      status = 'not_registered';
      label = disabledSubscriptionStaffIds.has(member.id) ? 'Reminders need turning on again' : 'Reminders never turned on';
    } else if (subscriptions.some((subscription) => failingSubscriptionIds.has(subscription.id))) {
      status = 'failing';
      label = 'Phone not accepting reminders';
    } else if (!signIn && !signOut) {
      status = 'reminders_off';
      label = 'Reminders switched off';
    } else if (!signIn || !signOut) {
      status = 'partly_off';
      label = signIn ? 'Sign-out reminder off' : 'Sign-in reminder off';
    }
    return status ? [{ fullName: member.fullName, label, staffId: member.id, status }] : [];
  });

  return {
    cannotReceive,
    date,
    day: {
      holidayName: holiday?.holidayNote || null,
      isHoliday,
      isWeekend,
    },
    generatedAt: clock.now.toISOString(),
    sections: {
      signIn: buildSection('sign_in'),
      signOut: buildSection('sign_out'),
    },
    totalStaff: staffRows.length,
  };
}
