import 'server-only';

import { and, eq, isNotNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry } from '@/db/schema';
import { getHolidayDatesForRange } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import { deleteUnsettledLatenessEntry, updateUnsettledLatenessEntry } from '@/lib/lateness-entry-writes';
import { publishRealtime } from '@/lib/realtime';
import { planStaffPenaltyRecalculation } from '@/lib/staff-penalty-recalculation';
import { isStaffLeaveDate } from '@/lib/staff-leave';
import { getFinanciallyProtectedLeaveEntryIds, getStaffLeavePeriodsForRange } from '@/lib/staff-leave-service';
import { getStaffTypeChanges } from '@/lib/staff-type-history';

function dateKeyOf(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

type ActorRef = {
  email?: string | null;
  id?: string | null;
};

type StaffRef = {
  fullName: string;
  id: string;
  isAttendanceOnly: boolean;
  isNssPersonnel: boolean;
};

export async function recalculateStaffStoredPenalties(input: {
  actor?: ActorRef | null;
  reason?: string;
  staffMember: StaffRef;
}) {
  const [attendanceRows, latenessRows, permissionRows] = await Promise.all([
    db.select()
      .from(attendanceRecord)
      .where(eq(attendanceRecord.staffId, input.staffMember.id)),
    db.select()
      .from(latenessEntry)
      .where(eq(latenessEntry.staffId, input.staffMember.id)),
    // Only permissions that count: approved ones and general pardons (as the sync uses).
    db.select()
      .from(attendancePermission)
      .where(and(
        eq(attendancePermission.staffId, input.staffMember.id),
        or(eq(attendancePermission.status, 'approved'), isNotNull(attendancePermission.generalPardonType)),
      )),
  ]);
  const dates = [...attendanceRows.map((row) => dateKeyOf(row.date)), ...latenessRows.map((row) => dateKeyOf(row.date))].sort();
  const [protectedEntryIds, leavePeriods, holidayDates, typeChanges] = await Promise.all([
    getFinanciallyProtectedLeaveEntryIds(latenessRows.map((row) => row.id)),
    dates.length === 0
      ? Promise.resolve([])
      : getStaffLeavePeriodsForRange({ endDate: dates[dates.length - 1], staffIds: [input.staffMember.id], startDate: dates[0] }),
    dates.length === 0 ? Promise.resolve(new Set<string>()) : getHolidayDatesForRange(dates[0], dates[dates.length - 1]),
    getStaffTypeChanges([input.staffMember.id]),
  ]);
  const leaveDates = new Set(dates.filter((date) => isStaffLeaveDate(leavePeriods, input.staffMember.id, date)));
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: attendanceRows,
    holidayDates,
    isAttendanceOnly: input.staffMember.isAttendanceOnly,
    isNssPersonnel: input.staffMember.isNssPersonnel,
    latenessEntries: latenessRows,
    leaveDates,
    permissions: permissionRows,
    protectedEntryIds,
    staffId: input.staffMember.id,
    typeChanges: typeChanges.get(input.staffMember.id),
  });
  const reason = input.reason || 'staff-penalty-recalculation';
  const now = new Date();
  let changed = 0;

  for (const update of plan.attendanceUpdates) {
    const before = attendanceRows.find((row) => row.id === update.id) || null;
    const [updated] = await db.update(attendanceRecord)
      .set({
        computedAmount: update.computedAmount,
        reason: update.reason,
        status: update.status,
        updatedAt: now,
      })
      .where(eq(attendanceRecord.id, update.id))
      .returning();

    if (!updated) continue;
    changed += 1;

    await writeAuditEvent({
      entityType: 'attendance',
      entityId: update.id,
      action: 'UPDATE',
      before,
      after: {
        ...updated,
        staff: {
          fullName: input.staffMember.fullName,
          isAttendanceOnly: input.staffMember.isAttendanceOnly,
          isNssPersonnel: input.staffMember.isNssPersonnel,
        },
      },
      actor: input.actor,
      publish: false,
      reason,
    });
  }

  for (const update of plan.latenessUpdates) {
    const before = latenessRows.find((row) => row.id === update.id) || null;
    const updated = await updateUnsettledLatenessEntry(update.id, {
      arrivalTime: update.arrivalTime,
      computedAmount: update.computedAmount,
      didNotSignOut: update.didNotSignOut,
      reason: update.reason,
      updatedAt: now,
    });

    if (!updated) continue;
    changed += 1;

    await writeAuditEvent({
      entityType: 'entry',
      entityId: update.id,
      action: 'UPDATE',
      before,
      after: {
        ...updated,
        staff: {
          fullName: input.staffMember.fullName,
          isAttendanceOnly: input.staffMember.isAttendanceOnly,
          isNssPersonnel: input.staffMember.isNssPersonnel,
        },
      },
      actor: input.actor,
      publish: false,
      reason,
    });
  }

  for (const values of plan.latenessCreates) {
    const [created] = await db.insert(latenessEntry)
      .values(values)
      .returning();

    if (!created) continue;
    changed += 1;

    await writeAuditEvent({
      entityType: 'entry',
      entityId: created.id,
      action: 'CREATE',
      before: null,
      after: {
        ...created,
        staff: {
          fullName: input.staffMember.fullName,
          isAttendanceOnly: input.staffMember.isAttendanceOnly,
          isNssPersonnel: input.staffMember.isNssPersonnel,
        },
      },
      actor: input.actor,
      publish: false,
      reason,
    });
  }

  for (const deletion of plan.latenessDeletes) {
    const before = latenessRows.find((row) => row.id === deletion.id) || null;
    if (!(await deleteUnsettledLatenessEntry(deletion.id))) continue;
    changed += 1;

    await writeAuditEvent({
      entityType: 'entry',
      entityId: deletion.id,
      action: 'DELETE',
      before: before
        ? {
            ...before,
            staff: {
              fullName: input.staffMember.fullName,
              isAttendanceOnly: input.staffMember.isAttendanceOnly,
              isNssPersonnel: input.staffMember.isNssPersonnel,
            },
          }
        : null,
      after: null,
      actor: input.actor,
      publish: false,
      reason,
    });
  }

  if (changed > 0) {
    publishRealtime('attendance', 'invalidate', { reason });
    publishRealtime('dashboard', 'invalidate', { reason });
    publishRealtime('entries', 'invalidate', { reason });
    publishRealtime('audit-trail', 'invalidate', { reason });
    publishRealtime('notifications', 'invalidate', { reason });
  }

  return {
    attendanceUpdated: plan.attendanceUpdates.length,
    changed,
    latenessCreated: plan.latenessCreates.length,
    latenessDeleted: plan.latenessDeletes.length,
    latenessUpdated: plan.latenessUpdates.length,
  };
}
