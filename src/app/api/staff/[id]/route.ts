// app/api/staff/[id]/route.ts
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, staff, staffDevice } from '@/db/schema';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { normalizeStaffEmail } from '@/lib/attendance';
import { syncStaffEmailIdentity, unlinkStaffEmailIdentity } from '@/lib/clerk-organization';
import { recalculateStaffStoredPenalties } from '@/lib/staff-penalty-recalculation-server';
import { enforceRole } from '@/lib/auth/roles';
import { getAccraDateKey } from '@/lib/date-key';
import {
  flagsForStaffType,
  isStaffType,
  nextDateKey,
  STAFF_TYPE_LABELS,
  staffReturnDateError,
  staffTypeChangeError,
  staffTypeOf,
  type StaffType,
} from '@/lib/staff-type';
import { saveStaffWithTypeChange, staffHistorySummary } from '@/lib/staff-type-history';

// Another save or an undo changed this person after the request read them: nothing was saved.
const CHANGED_MEANWHILE = 'This person was just changed by someone else. Reload and try again.';

type StaffUpdateBody = {
  active?: boolean;
  archived?: boolean;
  department?: string | null;
  email?: string | null;
  fullName?: string;
  gender?: string | null;
  isAttendanceOnly?: boolean;
  isNssPersonnel?: boolean;
  rank?: string | null;
  staffNo?: string | null;
  staffType?: string;
  /** The date a new type (or a restore) starts; earlier days keep the old type. */
  typeEffectiveFrom?: string;
  unit?: string | null;
};

// The type asked for: staffType, or (older clients) the two flags.
function requestedStaffType(body: StaffUpdateBody, current: StaffType): StaffType | null {
  if (isStaffType(body.staffType)) return body.staffType;
  if (body.isAttendanceOnly === undefined && body.isNssPersonnel === undefined) return null;
  if (body.isAttendanceOnly === true) return current === 'intern' || current === 'special' ? current : 'special';
  if (body.isNssPersonnel === true) return 'nss';
  return 'main';
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function applyProfileMetadataUpdate(
  updateData: Partial<typeof staff.$inferInsert>,
  key: 'gender' | 'rank' | 'staffNo',
  value: string | null | undefined,
  previousValue: string | null | undefined,
) {
  if (value === undefined) return;

  const normalized = normalizeOptionalText(value);
  if (normalized || !previousValue) {
    updateData[key] = normalized;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const { id } = await params;
    const [result] = await db.select().from(staff).where(eq(staff.id, id));

    if (!result) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch staff member:', error);
    return NextResponse.json({ error: 'Failed to fetch staff member' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const actor = await currentUser();
    const { id } = await params;
    const body = await request.json() as StaffUpdateBody;
    const {
      fullName,
      email,
      department,
      unit,
      staffNo,
      gender,
      rank,
      active,
      archived,
    } = body;

    // Capture before state for audit and metadata-preserving updates.
    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    const updateData: Partial<typeof staff.$inferInsert> = { updatedAt: new Date() };
    if (fullName !== undefined) updateData.fullName = fullName.trim();
    if (email !== undefined) updateData.email = normalizeStaffEmail(email);
    if (department !== undefined) updateData.department = normalizeOptionalText(department);
    if (unit !== undefined) updateData.unit = normalizeOptionalText(unit);
    applyProfileMetadataUpdate(updateData, 'staffNo', staffNo, before.staffNo);
    applyProfileMetadataUpdate(updateData, 'gender', gender, before.gender);
    applyProfileMetadataUpdate(updateData, 'rank', rank, before.rank);
    if (active !== undefined) updateData.active = active;
    if (archived !== undefined) {
      updateData.archived = archived;
      updateData.archivedAt = archived ? new Date() : null;
      updateData.active = archived ? false : true;
    }

    // One profile through every type: intern → NSS → special staff → main staff, from a chosen date.
    const today = getAccraDateKey();
    const beforeType = staffTypeOf(before);
    const nextType = requestedStaffType(body, beforeType) ?? beforeType;
    const typeChanged = nextType !== beforeType;
    const typeEffectiveFrom = typeof body.typeEffectiveFrom === 'string' && body.typeEffectiveFrom
      ? body.typeEffectiveFrom.slice(0, 10)
      : today;
    const wasAway = before.active !== true || before.archived === true;
    const nextActive = updateData.active ?? before.active;
    const nextArchived = updateData.archived ?? before.archived;
    const goingAway = !wasAway && (nextActive !== true || nextArchived === true);
    const comingBack = wasAway && nextActive === true && nextArchived !== true;
    const history = typeChanged || comingBack ? await staffHistorySummary(id) : null;
    const latestChangeDate = history?.latestChangeDate ?? null;
    if (typeChanged && wasAway && !comingBack) {
      // Their away days must stay away: the type is picked when they come back.
      return NextResponse.json({ error: 'Bring this person back (Activate or Restore) to change their type.' }, { status: 400 });
    }
    if (typeChanged && goingAway) {
      // One change at a time, so the history records both (the type, then the spell away).
      return NextResponse.json({ error: 'Change the type and deactivate or archive separately.' }, { status: 400 });
    }
    if (comingBack) {
      const returnError = staffReturnDateError({
        awayStart: history?.awayStart ?? null,
        effectiveFrom: typeEffectiveFrom,
        latestChangeDate,
        today,
      });
      if (returnError) return NextResponse.json({ error: returnError }, { status: 400 });
    }
    if (typeChanged) {
      const typeError = staffTypeChangeError({
        effectiveFrom: typeEffectiveFrom,
        from: beforeType,
        latestChangeDate,
        to: nextType,
        today,
      });
      if (typeError) return NextResponse.json({ error: typeError }, { status: 400 });
      const nextStaffNo = updateData.staffNo !== undefined ? updateData.staffNo : before.staffNo;
      const nextRank = updateData.rank !== undefined ? updateData.rank : before.rank;
      if (nextType === 'main' && (!nextStaffNo || !nextRank)) {
        return NextResponse.json({ error: 'Staff No. and Rank are required for main staff profiles.' }, { status: 400 });
      }
      updateData.staffType = nextType;
      Object.assign(updateData, flagsForStaffType(nextType));
    }
    if (updateData.email) {
      const [emailOwner] = await db.select({ id: staff.id })
        .from(staff)
        .where(and(eq(sql`lower(${staff.email})`, updateData.email), ne(staff.id, id)))
        .limit(1);

      if (emailOwner) {
        return NextResponse.json(
          { error: 'This email is already linked to another staff member.' },
          { status: 409 },
        );
      }
    }

    const previousEmail = normalizeStaffEmail(before.email);
    const nextEmail = email !== undefined
      ? normalizeStaffEmail(email)
      : previousEmail;
    const emailChanged = email !== undefined && previousEmail !== nextEmail;

    const actorEmail = actor?.emailAddresses[0]?.emailAddress || null;
    const expected = { active: before.active, archived: before.archived };
    const typeChange = typeChanged || comingBack
      // Back from away (deactivated or archived) or a new type: from the chosen date on.
      ? { actorEmail, effectiveFrom: typeEffectiveFrom, expected, previousType: beforeType, staffId: id, staffType: nextType, today }
      : goingAway
        // Away from tomorrow: today's sign-in still counts, later days are never charged.
        ? { actorEmail, effectiveFrom: nextDateKey(today), expected, previousType: beforeType, staffId: id, staffType: 'away' as const, today }
        : null;
    const updated = await saveStaffWithTypeChange(id, updateData, typeChange);

    if (!updated.length) {
      return typeChange
        ? NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 })
        : NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    const auditAction = typeof archived === 'boolean' && before.archived !== archived
      ? archived ? 'ARCHIVE' : 'RESTORE'
      : typeof active === 'boolean' && before.active !== active
      ? active ? 'ACTIVATE' : 'DEACTIVATE'
      : 'UPDATE';

    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: auditAction,
      before,
      after: typeChanged
        ? { ...updated[0], typeChange: { from: STAFF_TYPE_LABELS[beforeType], to: STAFF_TYPE_LABELS[nextType], effectiveFrom: typeEffectiveFrom } }
        : updated[0],
      reason: 'staff',
    });

    if (typeChanged) {
      await recalculateStaffStoredPenalties({
        actor: {
          email: actor?.emailAddresses[0]?.emailAddress,
          id: actor?.id,
        },
        reason: 'staff-type-changed',
        staffMember: {
          fullName: updated[0].fullName,
          id: updated[0].id,
          isAttendanceOnly: updated[0].isAttendanceOnly,
          isNssPersonnel: updated[0].isNssPersonnel,
        },
      });
    }

    if (updated[0].archived === true) {
      // Former staff give up their LateWatch sign-in seat (organisation membership and any pending
      // invitation). Their login and all history are kept; restoring them invites them back.
      const released = await Promise.all([...new Set([previousEmail, nextEmail].filter(Boolean))].map((staffEmail) => (
        unlinkStaffEmailIdentity({ email: staffEmail, releaseSeat: true, staffId: id })
      )));
      // Record every seat actually freed (also when re-saving someone archived before this existed).
      if (released.some((result) => 'seatReleased' in result && result.seatReleased)) {
        await writeAuditEvent({
          entityType: 'staff',
          entityId: id,
          action: 'UPDATE',
          before: null,
          after: { fullName: updated[0].fullName, seat: 'released' },
          reason: 'clerk-organization-seat-released',
        });
      }
    } else if (emailChanged) {
      const [registeredDevice] = await db.select()
        .from(staffDevice)
        .where(eq(staffDevice.staffId, id))
        .limit(1);

      if (registeredDevice) {
        await db.delete(staffDevice).where(eq(staffDevice.staffId, id));

        await writeAuditEvent({
          entityType: 'staff_device',
          entityId: id,
          action: 'DELETE',
          before: {
            lastSeenAt: registeredDevice.lastSeenAt,
            registeredAt: registeredDevice.registeredAt,
            staffName: updated[0].fullName,
          },
          after: {
            reason: 'staff-email-changed',
            staffName: updated[0].fullName,
          },
          reason: 'staff-email-changed',
        });
      }

      await unlinkStaffEmailIdentity({
        email: previousEmail,
        staffId: id,
      });

      await syncStaffEmailIdentity({
        actorUserId: actor?.id,
        email: nextEmail,
        isAttendanceOnly: updated[0].isAttendanceOnly,
        isNssPersonnel: updated[0].isNssPersonnel,
        staffId: id,
        staffName: updated[0].fullName,
      });
    } else if (nextEmail) {
      await syncStaffEmailIdentity({
        actorUserId: actor?.id,
        email: nextEmail,
        isAttendanceOnly: updated[0].isAttendanceOnly,
        isNssPersonnel: updated[0].isNssPersonnel,
        staffId: id,
        staffName: updated[0].fullName,
      });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    publishRealtime('payments', 'invalidate', { reason: 'staff' });

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error('Failed to update staff member:', error);
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const { id } = await params;
    const permanent = request.nextUrl.searchParams.get('permanent') === 'true';
    const purgeRecords = request.nextUrl.searchParams.get('purgeRecords') === 'true';

    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    if (permanent) {
      if (!before.archived) {
        return NextResponse.json(
          { error: 'Archive this staff member before permanently deleting them.' },
          { status: 400 },
        );
      }

      const [entryCount] = await db.select({ count: count() })
        .from(latenessEntry)
        .where(eq(latenessEntry.staffId, id));

      const totalEntries = Number(entryCount?.count || 0);
      if (totalEntries > 0 && !purgeRecords) {
        return NextResponse.json(
          {
            error: `This staff member has ${totalEntries} lateness record${totalEntries === 1 ? '' : 's'}. Archive them instead so historical exports remain accurate.`,
          },
          { status: 409 },
        );
      }

      await writeAuditEvent({
        entityType: 'staff',
        entityId: id,
        action: 'DELETE',
        before,
        after: {
          fullName: before.fullName,
          purgedEntryCount: purgeRecords ? totalEntries : 0,
        },
        reason: 'staff',
      });

      if (purgeRecords) {
        await db.delete(latenessEntry).where(eq(latenessEntry.staffId, id));
      }

      await db.delete(staff).where(eq(staff.id, id));

      publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

      publishRealtime('payments', 'invalidate', { reason: 'staff' });

      return NextResponse.json({ success: true, deleted: true, purgedEntryCount: purgeRecords ? totalEntries : 0 });
    }

    // Away from tomorrow, on the same profile: restoring brings them back from a chosen date.
    const today = getAccraDateKey();
    const archiveChange = before.active === true && before.archived !== true
      ? {
        actorEmail: (await currentUser())?.emailAddresses[0]?.emailAddress || null,
        effectiveFrom: nextDateKey(today),
        expected: { active: before.active, archived: before.archived },
        previousType: staffTypeOf(before),
        staffId: id,
        staffType: 'away' as const,
        today,
      }
      : null;
    const [updated] = await saveStaffWithTypeChange(
      id,
      { active: false, archived: true, archivedAt: new Date(), updatedAt: new Date() },
      archiveChange,
    );
    if (!updated) return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });

    // Archiving frees the person's LateWatch sign-in seat; history and login are kept.
    await unlinkStaffEmailIdentity({ email: before.email, releaseSeat: true, staffId: id });

    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: 'ARCHIVE',
      before,
      after: updated,
      reason: 'staff',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    publishRealtime('payments', 'invalidate', { reason: 'staff' });

    return NextResponse.json({ success: true, staff: updated });
  } catch (error) {
    console.error('Failed to delete staff member:', error);
    return NextResponse.json({ error: 'Failed to delete staff member' }, { status: 500 });
  }
}
