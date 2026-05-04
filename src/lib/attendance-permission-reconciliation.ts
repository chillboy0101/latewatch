import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry } from '@/db/schema';
import { getPermissionWindowBounds, isPermissionWindowActive } from '@/lib/attendance-permissions';
import { writeAuditEvent } from '@/lib/audit';
import { computePenalty } from '@/lib/penalty-calculator';
import { publishRealtime } from '@/lib/realtime';

type ActorRef = {
  email: string;
  id: string;
};

type StaffRef = {
  fullName: string;
  id: string;
};

type PermissionRecord = typeof attendancePermission.$inferSelect;
type AttendanceRecord = typeof attendanceRecord.$inferSelect;
type LatenessRecord = typeof latenessEntry.$inferSelect;

function normalizeTime(value: string | null | undefined) {
  const time = value?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function amountText(value: number) {
  return value.toFixed(2);
}

function approvedLateArrivalReason(permission: PermissionRecord) {
  const window = getPermissionWindowBounds(permission);
  return `Approved late arrival (${window.label}): ${permission.reason}`.trim();
}

function resolveNextAttendanceState(input: {
  attendance: AttendanceRecord;
  existingLateness: LatenessRecord | null;
  permission: PermissionRecord | null;
}) {
  const arrivalTime = normalizeTime(input.attendance.checkInTime);
  const didNotSignOut = input.existingLateness?.didNotSignOut === true;
  const permissionClearsLatePenalty = Boolean(
    input.permission?.status === 'approved' &&
    input.permission.permissionType === 'late_arrival' &&
    arrivalTime &&
    isPermissionWindowActive(input.permission, arrivalTime),
  );

  if (permissionClearsLatePenalty && input.permission) {
    const signOutPenalty = didNotSignOut
      ? computePenalty({ arrivalTime: null, didNotSignOut: true, isHoliday: false })
      : { amount: 0, reason: '' };
    const pardonReason = approvedLateArrivalReason(input.permission);

    return {
      amount: signOutPenalty.amount,
      didNotSignOut,
      pardoned: true,
      reason: signOutPenalty.amount > 0
        ? `${signOutPenalty.reason}; ${pardonReason}`
        : pardonReason,
      status: signOutPenalty.amount > 0 ? 'late' : 'present',
    };
  }

  const penalty = computePenalty({
    arrivalTime,
    didNotSignOut,
    isHoliday: false,
  });

  return {
    amount: penalty.amount,
    didNotSignOut,
    pardoned: false,
    reason: penalty.reason || null,
    status: penalty.amount > 0 ? 'late' : 'present',
  };
}

export async function reconcileAttendanceForPermission(input: {
  actor: ActorRef;
  activePermission: PermissionRecord | null;
  date: string;
  reason: string;
  staffMember: StaffRef;
}) {
  const [attendance] = await db.select()
    .from(attendanceRecord)
    .where(and(
      eq(attendanceRecord.staffId, input.staffMember.id),
      eq(attendanceRecord.date, input.date),
    ))
    .limit(1);

  if (!attendance) {
    return { changed: false, reason: 'no_attendance' };
  }

  const [existingLateness] = await db.select()
    .from(latenessEntry)
    .where(and(
      eq(latenessEntry.staffId, input.staffMember.id),
      eq(latenessEntry.date, input.date),
    ))
    .limit(1);

  const next = resolveNextAttendanceState({
    attendance,
    existingLateness: existingLateness || null,
    permission: input.activePermission,
  });
  const nextAmount = amountText(next.amount);
  const now = new Date();
  let changed = false;

  if (
    attendance.status !== next.status ||
    amountText(Number(attendance.computedAmount || 0)) !== nextAmount ||
    (attendance.reason || null) !== (next.reason || null)
  ) {
    const [updatedAttendance] = await db.update(attendanceRecord)
      .set({
        computedAmount: nextAmount,
        reason: next.reason,
        status: next.status,
        updatedAt: now,
      })
      .where(eq(attendanceRecord.id, attendance.id))
      .returning();

    await writeAuditEvent({
      entityType: 'attendance',
      entityId: attendance.id,
      action: 'UPDATE',
      before: attendance,
      after: {
        ...updatedAttendance,
        permissionReason: input.reason,
        staff: { fullName: input.staffMember.fullName },
      },
      actor: { email: input.actor.email, id: input.actor.id },
      reason: input.reason,
    });

    changed = true;
  }

  if (next.amount > 0) {
    if (existingLateness) {
      const existingAmount = amountText(Number(existingLateness.computedAmount || 0));
      if (
        existingAmount !== nextAmount ||
        existingLateness.reason !== next.reason ||
        existingLateness.didNotSignOut !== next.didNotSignOut
      ) {
        const [updatedEntry] = await db.update(latenessEntry)
          .set({
            arrivalTime: normalizeTime(attendance.checkInTime),
            computedAmount: nextAmount,
            didNotSignOut: next.didNotSignOut,
            reason: next.reason || '',
            updatedAt: now,
          })
          .where(eq(latenessEntry.id, existingLateness.id))
          .returning();

        await writeAuditEvent({
          entityType: 'entry',
          entityId: existingLateness.id,
          action: 'UPDATE',
          before: existingLateness,
          after: {
            ...updatedEntry,
            permissionReason: input.reason,
            staff: { fullName: input.staffMember.fullName },
          },
          actor: { email: input.actor.email, id: input.actor.id },
          reason: input.reason,
        });

        changed = true;
      }
    } else {
      const [createdEntry] = await db.insert(latenessEntry)
        .values({
          arrivalTime: normalizeTime(attendance.checkInTime),
          computedAmount: nextAmount,
          date: input.date,
          didNotSignOut: next.didNotSignOut,
          reason: next.reason || '',
          staffId: input.staffMember.id,
        })
        .returning();

      await writeAuditEvent({
        entityType: 'entry',
        entityId: createdEntry.id,
        action: 'CREATE',
        before: null,
        after: {
          ...createdEntry,
          permissionReason: input.reason,
          staff: { fullName: input.staffMember.fullName },
        },
        actor: { email: input.actor.email, id: input.actor.id },
        reason: input.reason,
      });

      changed = true;
    }
  } else if (existingLateness) {
    await db.delete(latenessEntry).where(eq(latenessEntry.id, existingLateness.id));

    await writeAuditEvent({
      entityType: 'entry',
      entityId: existingLateness.id,
      action: 'DELETE',
      before: {
        ...existingLateness,
        permissionReason: input.reason,
        staff: { fullName: input.staffMember.fullName },
      },
      after: null,
      actor: { email: input.actor.email, id: input.actor.id },
      reason: input.reason,
    });

    changed = true;
  }

  if (changed) {
    publishRealtime('attendance', 'invalidate', { reason: input.reason });
    publishRealtime('dashboard', 'invalidate', { reason: input.reason });
    publishRealtime('entries', 'invalidate', { reason: input.reason });
    publishRealtime('audit-trail', 'invalidate', { reason: input.reason });
    publishRealtime('notifications', 'invalidate', { reason: input.reason });
  }

  return {
    changed,
    pardoned: next.pardoned,
    penaltyAmount: nextAmount,
    reason: next.pardoned ? 'late_arrival_pardoned' : 'penalty_recalculated',
  };
}
