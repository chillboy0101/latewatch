import { currentUser } from '@clerk/nextjs/server';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staffLeavePeriod } from '@/db/schema';
import { isIsoDateKey } from '@/lib/date-format';
import { getEffectiveLeaveEndDate, leaveOverlapError, STAFF_LEAVE_TYPES, type StaffLeaveType } from '@/lib/staff-leave';
import { getAccraDateKey } from '@/lib/date-key';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import {
  auditReplacedPermissions,
  deletePermissionsCoveredByLeave,
  findInactivePeriodOverlap,
  findOverlappingStaffLeavePeriod,
  replacedPermissionSummary,
} from '@/lib/staff-leave-service';
import { nextDateKey, publishLeaveChange, recalculateDaysAfterLeaveChange } from '@/lib/staff-leave-return';

export const dynamic = 'force-dynamic';

const VALID_LEAVE_TYPES = new Set<string>(STAFF_LEAVE_TYPES.map((type) => type.value));

type Actor = { email: string; id: string | null };

function actorOf(user: Awaited<ReturnType<typeof currentUser>>): Actor {
  return {
    email: user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system',
    id: user?.id || null,
  };
}

function laterKey(left: string, right: string) {
  return left > right ? left : right;
}

// Fix a leave entered with the wrong dates or type (any leave, open or already ended). Its new
// days take over approved permissions like a new leave, and every day whose status changed,
// old range and new, is recalculated.
async function correctLeave(id: string, body: Record<string, unknown>, actor: Actor) {
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  const endDate = typeof body.endDate === 'string' ? body.endDate : '';
  const leaveType = typeof body.leaveType === 'string' ? body.leaveType : '';
  if (!isIsoDateKey(startDate) || !isIsoDateKey(endDate) || startDate > endDate) {
    return NextResponse.json({ error: 'Select valid leave dates: the end on or after the start' }, { status: 400 });
  }
  if (!VALID_LEAVE_TYPES.has(leaveType)) {
    return NextResponse.json({ error: 'Select a valid leave type' }, { status: 400 });
  }

  const [before] = await db.select()
    .from(staffLeavePeriod)
    .where(and(eq(staffLeavePeriod.id, id), ne(staffLeavePeriod.source, 'staff_status')))
    .limit(1);
  if (!before) return NextResponse.json({ error: 'Leave period was not found' }, { status: 404 });
  if (before.returnedOn && before.returnedOn <= startDate) {
    return NextResponse.json({ error: `They were back at work on ${before.returnedOn}, so the leave must start before that.` }, { status: 400 });
  }

  const staffId = before.staffId;
  const coveredEnd = getEffectiveLeaveEndDate({ endDate, returnedOn: before.returnedOn }) || endDate;
  const overlap = await findOverlappingStaffLeavePeriod({ endDate: coveredEnd, excludeId: id, staffId, startDate });
  if (overlap) return NextResponse.json({ error: 'These dates overlap another leave period' }, { status: 409 });
  const inactive = await findInactivePeriodOverlap({ endDate: coveredEnd, staffId, startDate });
  if (inactive) {
    return NextResponse.json({ error: `This person was deactivated from ${inactive.startDate}. The leave can't run into those dates.` }, { status: 409 });
  }

  let saved;
  try {
    saved = await db.batch([
      deletePermissionsCoveredByLeave({ endDate: coveredEnd, staffId, startDate }),
      db.update(staffLeavePeriod)
        .set({ endDate, leaveType: leaveType as StaffLeaveType, startDate, updatedAt: new Date() })
        .where(eq(staffLeavePeriod.id, id))
        .returning(),
    ] as const);
  } catch (error) {
    const overlapMessage = leaveOverlapError(error);
    if (overlapMessage) return NextResponse.json({ error: overlapMessage }, { status: 409 });
    throw error;
  }
  const [replacedPermissions, [period]] = saved;

  await writeAuditEvent({
    entityType: 'staff_leave_period',
    entityId: id,
    action: 'UPDATE',
    before,
    after: { ...period, replacedPermissions },
    actor,
    reason: 'staff-leave-corrected',
  });
  await auditReplacedPermissions({ actor, permissions: replacedPermissions, staffId });

  // Re-apply the normal rules to every past day in the old range and the new one.
  const today = getAccraDateKey();
  const oldEnd = getEffectiveLeaveEndDate(before) || today;
  await recalculateDaysAfterLeaveChange(
    before.startDate < startDate ? before.startDate : startDate,
    laterKey(oldEnd, coveredEnd),
  );
  publishLeaveChange('staff-leave-corrected', staffId);

  return NextResponse.json({ ...period, ...replacedPermissionSummary(replacedPermissions) });
}

// Remove a leave entered by mistake: its days go back to the normal rules (charged as usual).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const actor = actorOf(await currentUser());
    const { id } = await params;
    const [before] = await db.select()
      .from(staffLeavePeriod)
      .where(and(eq(staffLeavePeriod.id, id), ne(staffLeavePeriod.source, 'staff_status')))
      .limit(1);
    if (!before) return NextResponse.json({ error: 'Leave period was not found' }, { status: 404 });

    await db.delete(staffLeavePeriod).where(eq(staffLeavePeriod.id, id));
    await writeAuditEvent({
      entityType: 'staff_leave_period',
      entityId: id,
      action: 'DELETE',
      before,
      after: null,
      actor,
      reason: 'staff-leave-removed',
    });
    await recalculateDaysAfterLeaveChange(before.startDate, getEffectiveLeaveEndDate(before) || getAccraDateKey());
    publishLeaveChange('staff-leave-removed', before.staffId);

    return NextResponse.json({ removed: true, staffId: before.staffId });
  } catch (error) {
    console.error('Failed to remove leave:', error);
    return NextResponse.json({ error: 'Failed to remove leave' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const user = await currentUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.correct === true) return await correctLeave(id, body, actorOf(user));
    const returnedOn = typeof body?.returnedOn === 'string' ? body.returnedOn : '';
    const endDate = typeof body?.endDate === 'string' ? body.endDate : '';
    if (!returnedOn && !endDate) {
      return NextResponse.json({ error: 'Select a return date or a new end date' }, { status: 400 });
    }
    if (returnedOn && (!isIsoDateKey(returnedOn) || returnedOn > getAccraDateKey())) {
      return NextResponse.json({ error: 'Select a valid actual return date that is not in the future' }, { status: 400 });
    }
    if (endDate && !isIsoDateKey(endDate)) {
      return NextResponse.json({ error: 'Select a valid end date' }, { status: 400 });
    }

    // Any open leave can be closed or extended, whichever way it was recorded.
    const [before] = await db.select()
      .from(staffLeavePeriod)
      .where(and(eq(staffLeavePeriod.id, id), ne(staffLeavePeriod.source, 'staff_status'), isNull(staffLeavePeriod.returnedOn)))
      .limit(1);
    if (!before) return NextResponse.json({ error: 'Leave period was not found or is already closed' }, { status: 404 });
    if (returnedOn && returnedOn <= before.startDate) {
      return NextResponse.json({ error: 'Return date must be after the leave start date' }, { status: 400 });
    }
    // A return wins when both are sent; the end date is only checked (and applied) on its own.
    const extending = !returnedOn && Boolean(endDate);
    if (extending) {
      if (endDate < before.startDate) {
        return NextResponse.json({ error: 'End date must be on or after the leave start date' }, { status: 400 });
      }
      const overlap = await findOverlappingStaffLeavePeriod({ endDate, excludeId: id, staffId: before.staffId, startDate: before.startDate });
      if (overlap) return NextResponse.json({ error: 'These dates overlap another leave period' }, { status: 409 });
      const inactive = await findInactivePeriodOverlap({ endDate, staffId: before.staffId, startDate: before.startDate });
      if (inactive) {
        return NextResponse.json({ error: `This person was deactivated from ${inactive.startDate}. The leave can't run into those dates.` }, { status: 409 });
      }
    }

    const actorEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system';
    const actor = { email: actorEmail, id: user?.id || null };
    const updateLeave = db.update(staffLeavePeriod)
      .set(returnedOn
        ? { closedAt: new Date(), closedByEmail: actorEmail, returnedOn, updatedAt: new Date() }
        : { endDate, updatedAt: new Date() })
      .where(eq(staffLeavePeriod.id, id))
      .returning();
    // A longer leave takes over permissions already approved on its days, removed in the same
    // transaction. Recording a return only shortens the leave, so nothing is replaced then.
    let replacedPermissions: Awaited<ReturnType<typeof deletePermissionsCoveredByLeave>> = [];
    let period: typeof staffLeavePeriod.$inferSelect;
    try {
      if (extending) {
        const [deleted, [updated]] = await db.batch([
          deletePermissionsCoveredByLeave({ endDate, staffId: before.staffId, startDate: before.startDate }),
          updateLeave,
        ] as const);
        replacedPermissions = deleted;
        period = updated;
      } else {
        [period] = await updateLeave;
      }
    } catch (error) {
      const overlapMessage = leaveOverlapError(error);
      if (overlapMessage) return NextResponse.json({ error: overlapMessage }, { status: 409 });
      throw error;
    }
    const reason = returnedOn ? 'approved-staff-leave-early-return' : 'staff-leave-end-date-changed';

    await writeAuditEvent({
      entityType: 'staff_leave_period',
      entityId: id,
      action: 'UPDATE',
      before,
      after: replacedPermissions.length > 0 ? { ...period, replacedPermissions } : period,
      actor,
      reason,
    });
    await auditReplacedPermissions({ actor, permissions: replacedPermissions, staffId: before.staffId });

    // Past days whose leave status changed get the normal rules re-applied (or cleared).
    const today = getAccraDateKey();
    if (returnedOn) {
      await recalculateDaysAfterLeaveChange(returnedOn, today);
    } else {
      const oldEnd = before.endDate;
      const earlier = oldEnd && oldEnd < endDate ? oldEnd : endDate;
      const later = oldEnd && oldEnd > endDate ? oldEnd : oldEnd ? endDate : today;
      await recalculateDaysAfterLeaveChange(nextDateKey(earlier), later);
    }
    publishLeaveChange(reason, period.staffId);

    return NextResponse.json({ ...period, ...replacedPermissionSummary(replacedPermissions) });
  } catch (error) {
    console.error('Failed to update leave:', error);
    return NextResponse.json({ error: 'Failed to update leave' }, { status: 500 });
  }
}