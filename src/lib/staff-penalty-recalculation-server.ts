import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { planStaffPenaltyRecalculation } from '@/lib/staff-penalty-recalculation';

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
    db.select()
      .from(attendancePermission)
      .where(eq(attendancePermission.staffId, input.staffMember.id)),
  ]);
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: attendanceRows,
    isAttendanceOnly: input.staffMember.isAttendanceOnly,
    isNssPersonnel: input.staffMember.isNssPersonnel,
    latenessEntries: latenessRows,
    permissions: permissionRows,
    staffId: input.staffMember.id,
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
    const [updated] = await db.update(latenessEntry)
      .set({
        arrivalTime: update.arrivalTime,
        computedAmount: update.computedAmount,
        didNotSignOut: update.didNotSignOut,
        reason: update.reason,
        updatedAt: now,
      })
      .where(eq(latenessEntry.id, update.id))
      .returning();

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
    await db.delete(latenessEntry).where(eq(latenessEntry.id, deletion.id));
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
