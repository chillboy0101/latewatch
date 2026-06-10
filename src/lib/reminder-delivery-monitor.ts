import 'server-only';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, pushReminderDelivery, pushSubscription, staff } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';

export type ReminderMonitorType = 'sign_in' | 'sign_out';
export type ReminderMonitorRowStatus = 'sent' | 'failed' | 'pending' | 'missing' | 'waiting' | 'skipped' | 'no_device';

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

function minutesFromTimeKey(timeKey: string) {
  const [hour = '0', minute = '0'] = timeKey.split(':');
  return Number(hour) * 60 + Number(minute);
}

function hasScheduledTimePassed(input: { date: string; reminderType: ReminderMonitorType }) {
  const clock = getAccraClock();
  if (input.date < clock.dateKey) return true;
  if (input.date > clock.dateKey) return false;

  return minutesFromTimeKey(clock.timeKey) >= REMINDER_SCHEDULES[input.reminderType].scheduledMinutes;
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

function deliveryCounts(rows: Array<{ error: string | null; sentAt: Date | string | null; status: string }>) {
  const sent = rows.filter((row) => row.status === 'sent').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const disabled = rows.filter((row) => row.status === 'disabled').length;
  const pending = rows.filter((row) => row.status === 'pending').length;
  const latestError = rows.find((row) => row.error)?.error || null;

  return {
    disabled,
    failed,
    latestError,
    latestSentAt: latestDate(rows.map((row) => row.sentAt)),
    pending,
    sent,
  };
}

function statusTone(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'missing') return 'danger';
  if (status === 'pending' || status === 'waiting') return 'warning';
  if (status === 'no_device') return 'muted';
  return 'neutral';
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
      eq(staff.isAttendanceOnly, false),
    ))
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

  const staffIds = staffRows.map((row) => row.id);
  const [attendanceRows, permissionRows, subscriptionRows, deliveryRows] = staffIds.length
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
        db.select({
          disabledAt: pushSubscription.disabledAt,
          id: pushSubscription.id,
          signInEnabled: pushSubscription.signInEnabled,
          signOutEnabled: pushSubscription.signOutEnabled,
          staffId: pushSubscription.staffId,
          updatedAt: pushSubscription.updatedAt,
          userAgent: pushSubscription.userAgent,
        })
          .from(pushSubscription)
          .where(and(
            isNull(pushSubscription.disabledAt),
            inArray(pushSubscription.staffId, staffIds),
          )),
        db.select({
          createdAt: pushReminderDelivery.createdAt,
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
      ])
    : [[], [], [], []];

  const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
  const permissionByStaffId = new Map(permissionRows.map((row) => [row.staffId, row]));
  const subscriptionsByStaffId = new Map<string, typeof subscriptionRows>();
  const deliveriesByStaffAndType = new Map<string, typeof deliveryRows>();

  for (const subscription of subscriptionRows) {
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
    const scheduledPassed = hasScheduledTimePassed({ date, reminderType });

    return staffRows.map((member) => {
      const attendance = attendanceByStaffId.get(member.id) || null;
      const permission = permissionByStaffId.get(member.id) || null;
      const subscriptions = subscriptionsByStaffId.get(member.id) || [];
      const enabledSubscriptions = subscriptions.filter((subscription) => (
        reminderType === 'sign_in' ? subscription.signInEnabled : subscription.signOutEnabled
      ));
      const deliveries = deliveriesByStaffAndType.get(`${member.id}:${reminderType}`) || [];
      const counts = deliveryCounts(deliveries);

      let eligible = false;
      let reason = '';
      let status: ReminderMonitorRowStatus = 'skipped';

      if (isWeekend) {
        reason = 'Weekend';
      } else if (isHoliday) {
        reason = holiday?.holidayNote ? `Holiday: ${holiday.holidayNote}` : 'Holiday';
      } else if (reminderType === 'sign_in' && attendance?.checkInTime) {
        reason = `Already signed in at ${attendance.checkInTime}`;
      } else if (reminderType === 'sign_in' && ['absence', 'late_arrival'].includes(permission?.permissionType || '')) {
        reason = permissionLabel(permission?.permissionType);
      } else if (reminderType === 'sign_out' && !attendance?.checkInTime) {
        reason = 'Not signed in yet';
      } else if (reminderType === 'sign_out' && attendance?.signOutTime) {
        reason = `Already signed out at ${attendance.signOutTime}`;
      } else if (enabledSubscriptions.length === 0) {
        status = 'no_device';
        reason = reminderType === 'sign_in'
          ? 'No enabled sign-in reminder device'
          : 'No enabled sign-out reminder device';
      } else {
        eligible = true;
        if (counts.sent > 0) {
          status = 'sent';
          reason = counts.sent === 1 ? 'Sent to 1 device' : `Sent to ${counts.sent} devices`;
        } else if (counts.failed > 0 || counts.disabled > 0) {
          status = 'failed';
          reason = counts.latestError || (counts.disabled > 0 ? 'Expired push endpoint disabled' : 'Push send failed');
        } else if (counts.pending > 0) {
          status = 'pending';
          reason = 'Delivery reserved; waiting for send result';
        } else if (scheduledPassed) {
          status = 'missing';
          reason = 'Eligible but no delivery record found';
        } else {
          status = 'waiting';
          reason = `Scheduled for ${REMINDER_SCHEDULES[reminderType].scheduledTime}`;
        }
      }

      return {
        activeReminderDevices: subscriptions.length,
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
    const summary = {
      eligible: rows.filter((row) => row.eligible).length,
      failed: rows.filter((row) => row.status === 'failed').length,
      missing: rows.filter((row) => row.status === 'missing').length,
      noDevice: rows.filter((row) => row.status === 'no_device').length,
      pending: rows.filter((row) => row.status === 'pending').length,
      sent: rows.filter((row) => row.status === 'sent').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
      waiting: rows.filter((row) => row.status === 'waiting').length,
    };
    const alerts: Array<{ message: string; tone: 'danger' | 'warning' }> = [];

    if (scheduledPassed && summary.eligible > 0 && summary.sent === 0) {
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

    if (summary.noDevice > 0) {
      alerts.push({
        message: `${summary.noDevice} staff have no enabled reminder device for this reminder type.`,
        tone: 'warning',
      });
    }

    return {
      alerts,
      label: REMINDER_SCHEDULES[reminderType].label,
      reminderType,
      rows,
      scheduledPassed,
      scheduledTime: REMINDER_SCHEDULES[reminderType].scheduledTime,
      summary,
    };
  }

  return {
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
