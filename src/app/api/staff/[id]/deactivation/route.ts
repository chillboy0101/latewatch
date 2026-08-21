import { currentUser } from '@clerk/nextjs/server';
import { and, eq, gte, isNull, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  attendancePermission,
  latenessEntry,
  latenessPaymentAllocation,
  staff,
  staffDevice,
  staffInactivePeriod,
  staffLeavePeriod,
} from '@/db/schema';
import { enforceRole } from '@/lib/auth/roles';
import { writeAuditEvent } from '@/lib/audit';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { getAccraDateKey } from '@/lib/date-key';
import {
  isStaffSessionRevocationError,
  revokeStaffLoginSessions,
} from '@/lib/clerk-session-revocation';
import { disableActivePushSubscriptionsForStaff } from '@/lib/push-subscriptions';
import { publishRealtime } from '@/lib/realtime';
import { normalizeStaffInactiveReason } from '@/lib/staff-inactive-policy';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isOverlapError(error: unknown) {
  const candidate = error as { cause?: { code?: string; message?: string }; code?: string; message?: string } | null;
  return candidate?.code === '23P01' || candidate?.cause?.code === '23P01'
    || candidate?.message?.includes('attendance_permission_overlap') === true
    || candidate?.cause?.message?.includes('attendance_permission_overlap') === true;
}

function publishStaffInvalidations(staffId: string) {
  for (const channel of ['attendance', 'dashboard', 'entries', 'notifications'] as const) {
    publishRealtime(channel, 'invalidate', { reason: 'staff-deactivation', staffId });
  }
  publishRealtime('payments', 'invalidate', { reason: 'staff-deactivation', staffId });
  publishRealtime('staff-penalty-history', 'invalidate', { reason: 'staff-deactivation', staffId });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const startDate = optionalText(body?.startDate);
    const reasonCode = normalizeStaffInactiveReason(body?.reasonCode);
    const note = optionalText(body?.note);
    const today = getAccraDateKey();

    if (!startDate || !DATE_KEY.test(startDate)) {
      return NextResponse.json({ error: 'A valid deactivation date is required' }, { status: 400 });
    }
    if (startDate > today) {
      return NextResponse.json({ error: 'Deactivation cannot start in the future' }, { status: 400 });
    }
    if (!reasonCode) {
      return NextResponse.json({ error: 'Select a valid deactivation reason' }, { status: 400 });
    }
    if (reasonCode === 'other' && !note) {
      return NextResponse.json({ error: 'Add a note when the reason is Other' }, { status: 400 });
    }

    const [member] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    if (!member) return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    if (member.archived) return NextResponse.json({ error: 'Former personnel cannot be deactivated' }, { status: 409 });
    const createdDate = member.createdAt ? member.createdAt.toISOString().slice(0, 10) : null;
    if (createdDate && startDate < createdDate) {
      return NextResponse.json({ error: `Deactivation cannot start before ${createdDate}` }, { status: 400 });
    }

    const [openPeriod, leaveConflict, permissionConflict, paidConflict, device] = await Promise.all([
      db.select({ id: staffInactivePeriod.id })
        .from(staffInactivePeriod)
        .where(and(eq(staffInactivePeriod.staffId, id), isNull(staffInactivePeriod.reactivatedOn)))
        .limit(1),
      db.select({ id: staffLeavePeriod.id, startDate: staffLeavePeriod.startDate })
        .from(staffLeavePeriod)
        .where(and(
          eq(staffLeavePeriod.staffId, id),
          or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, startDate)),
        ))
        .limit(1),
      db.select({ date: attendancePermission.date, id: attendancePermission.id })
        .from(attendancePermission)
        .where(and(
          eq(attendancePermission.staffId, id),
          eq(attendancePermission.status, 'approved'),
          gte(attendancePermission.date, startDate),
        ))
        .limit(1),
      db.select({ id: latenessPaymentAllocation.id })
        .from(latenessPaymentAllocation)
        .innerJoin(latenessEntry, eq(latenessPaymentAllocation.entryId, latenessEntry.id))
        .where(and(eq(latenessEntry.staffId, id), gte(latenessEntry.date, startDate)))
        .limit(1),
      db.select({ userId: staffDevice.userId })
        .from(staffDevice)
        .where(eq(staffDevice.staffId, id))
        .limit(1),
    ]);

    if (openPeriod.length) return NextResponse.json({ error: 'This staff member is already inactive' }, { status: 409 });
    if (leaveConflict.length || permissionConflict.length) {
      return NextResponse.json({ error: 'End or remove overlapping attendance permissions before deactivating this staff member' }, { status: 409 });
    }
    if (paidConflict.length) {
      return NextResponse.json({ error: 'Deactivation would change a paid penalty. Reverse or resolve the payment first.' }, { status: 409 });
    }

    const actorEmail = actor.emailAddresses[0]?.emailAddress || 'unknown';
    const now = new Date();
    const [period] = await db.insert(staffInactivePeriod).values({
      createdByEmail: actorEmail,
      note,
      reasonCode,
      staffId: id,
      startDate,
    }).returning();
    const [updated] = await db.update(staff)
      .set({ active: false, updatedAt: now })
      .where(eq(staff.id, id))
      .returning();
    const disabledPushSubscriptions = await disableActivePushSubscriptionsForStaff(id, now);

    let revokedSessions = 0;
    let accessCleanupWarning: string | null = null;
    let sessionRevocation: unknown = null;
    try {
      const result = await revokeStaffLoginSessions({
        deviceUserId: device[0]?.userId,
        staffEmail: member.email,
      });
      sessionRevocation = result;
      revokedSessions = result.revokedSessions;
    } catch (error) {
      if (!isStaffSessionRevocationError(error)) throw error;
      revokedSessions = error.revokedSessions;
      accessCleanupWarning = 'The staff profile is inactive, but not every Clerk session could be revoked.';
      sessionRevocation = { status: 'partial_failure', userId: error.userId };
    }

    const reconciliation = await syncLatenessEntriesFromAttendanceForRange(startDate, today);
    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: 'DEACTIVATE',
      before: member,
      after: {
        ...updated,
        accessCleanupWarning,
        disabledPushSubscriptions,
        inactivePeriod: period,
        revokedSessions,
        sessionRevocation,
      },
      actor: { email: actorEmail, id: actor.id },
      reason: 'staff-deactivation',
    });
    publishStaffInvalidations(id);

    return NextResponse.json({
      ...updated,
      accessCleanupWarning,
      disabledPushSubscriptions,
      inactivePeriod: period,
      reconciliation,
      revokedSessions,
      sessionRevocation,
    });
  } catch (error) {
    if (isOverlapError(error)) {
      return NextResponse.json({ error: 'Deactivation overlaps an attendance permission or inactive period' }, { status: 409 });
    }
    console.error('Failed to deactivate staff member:', error);
    return NextResponse.json({ error: 'Failed to deactivate staff member' }, { status: 500 });
  }
}
