// app/api/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, entrySubmission, latenessEntry, workCalendar, staff } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { getAuditActor, writeAuditEvent } from '@/lib/audit';
import {
  syncLatenessEntriesFromAttendanceForDate,
  syncLatenessEntriesFromAttendanceForRange,
} from '@/lib/attendance-lateness-sync';
import { mergeAttendanceRowsIntoEntryRows } from '@/lib/lateness-entry-presentation';
import {
  manualAttendanceCorrectionChanged,
  resolveManualAttendanceCorrection,
  resolveManualPenalty,
} from '@/lib/manual-attendance-correction';
import {
  NO_SHOW_SIGN_IN_AMOUNT,
  NO_SHOW_SIGN_IN_REASON,
  NO_SHOW_SIGN_IN_WAIVED_REASON,
} from '@/lib/penalty-calculator';

export const dynamic = 'force-dynamic';

async function getAttendanceRowsForEntries(start: string, end: string) {
  return db.select({
    id: attendanceRecord.id,
    staffId: attendanceRecord.staffId,
    date: attendanceRecord.date,
    checkInTime: attendanceRecord.checkInTime,
    reason: attendanceRecord.reason,
    noSignOutWaived: attendanceRecord.noSignOutWaived,
    noSignOutWaivedAt: attendanceRecord.noSignOutWaivedAt,
    noSignOutWaivedReason: attendanceRecord.noSignOutWaivedReason,
    noShowSignInWaived: attendanceRecord.noShowSignInWaived,
    noShowSignInWaivedAt: attendanceRecord.noShowSignInWaivedAt,
    noShowSignInWaivedReason: attendanceRecord.noShowSignInWaivedReason,
    signOutTime: attendanceRecord.signOutTime,
    source: attendanceRecord.source,
    computedAmount: attendanceRecord.computedAmount,
    createdAt: attendanceRecord.createdAt,
    updatedAt: attendanceRecord.updatedAt,
    status: attendanceRecord.status,
  })
    .from(attendanceRecord)
    .where(and(gte(attendanceRecord.date, start), lte(attendanceRecord.date, end)));
}

async function getPermissionRowsForEntries(start: string, end: string) {
  return db.select({
    arrivalWindow: attendancePermission.arrivalWindow,
    expectedEndTime: attendancePermission.expectedEndTime,
    expectedStartTime: attendancePermission.expectedStartTime,
    id: attendancePermission.id,
    staffId: attendancePermission.staffId,
    date: attendancePermission.date,
    permissionType: attendancePermission.permissionType,
    reason: attendancePermission.reason,
    status: attendancePermission.status,
  })
    .from(attendancePermission)
    .where(and(
      gte(attendancePermission.date, start),
      lte(attendancePermission.date, end),
      eq(attendancePermission.status, 'approved'),
    ));
}

async function getActivePermissionsForDate(date: string) {
  const permissionRows = await db.select()
    .from(attendancePermission)
    .where(and(eq(attendancePermission.date, date), eq(attendancePermission.status, 'approved')));

  return new Map(permissionRows.map((permission) => [permission.staffId, permission]));
}

function buildManualCheckInAt(date: string, time: string) {
  return new Date(`${date}T${time}:00.000Z`);
}

function buildManualSignOutAt(date: string, time: string) {
  return new Date(`${date}T${time}:00.000Z`);
}

function normalizeEntryTime(value: string | null | undefined) {
  const time = value?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function hasOwn(object: object, property: string) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function normalizeEntryAmount(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function latenessEntryChanged(input: {
  existing: {
    arrivalTime: string | null;
    computedAmount: string | number | null;
    didNotSignOut: boolean | null;
    reason: string | null;
  };
  next: {
    arrivalTime: string | null;
    computedAmount: string;
    didNotSignOut: boolean;
    reason: string | null;
  };
}) {
  return (
    normalizeEntryTime(input.existing.arrivalTime) !== normalizeEntryTime(input.next.arrivalTime) ||
    (input.existing.didNotSignOut === true) !== input.next.didNotSignOut ||
    normalizeEntryAmount(input.existing.computedAmount) !== normalizeEntryAmount(input.next.computedAmount) ||
    (input.existing.reason || null) !== (input.next.reason || null)
  );
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    // Single date query
    if (date) {
      await syncLatenessEntriesFromAttendanceForDate(date);
      const entries = await db.select({
        id: latenessEntry.id,
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        didNotSignOut: latenessEntry.didNotSignOut,
        reason: latenessEntry.reason,
        computedAmount: latenessEntry.computedAmount,
        createdAt: latenessEntry.createdAt,
      })
      .from(latenessEntry)
      .where(eq(latenessEntry.date, date));
      const attendanceRows = await getAttendanceRowsForEntries(date, date);
      const permissionRows = await getPermissionRowsForEntries(date, date);
      const responseRows = mergeAttendanceRowsIntoEntryRows({ attendanceRows, entryRows: entries, permissionRows });

      return NextResponse.json(responseRows, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    // Date range query (for exports/performance)
    if (start && end) {
      await syncLatenessEntriesFromAttendanceForRange(start, end);
      const entries = await db.select({
        id: latenessEntry.id,
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        didNotSignOut: latenessEntry.didNotSignOut,
        reason: latenessEntry.reason,
        computedAmount: latenessEntry.computedAmount,
        createdAt: latenessEntry.createdAt,
      })
      .from(latenessEntry)
      .where(and(gte(latenessEntry.date, start), lte(latenessEntry.date, end)));
      const attendanceRows = await getAttendanceRowsForEntries(start, end);
      const permissionRows = await getPermissionRowsForEntries(start, end);
      const responseRows = mergeAttendanceRowsIntoEntryRows({ attendanceRows, entryRows: entries, permissionRows });

      return NextResponse.json(responseRows, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({ error: 'Date or start/end parameters required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to fetch entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get current user for audit logging (optional — we still allow the save even if it fails)
    const body = await request.json();
    const { date, entries } = body;

    if (!date || !Array.isArray(entries)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const selectedDate = new Date(`${date}T00:00:00`);
    if (selectedDate.getDay() === 0 || selectedDate.getDay() === 6) {
      return NextResponse.json(
        { error: 'Cannot create entries for weekends' },
        { status: 400 },
      );
    }

    // Check if the date is a holiday
    const [holidayCheck] = await db.select()
      .from(workCalendar)
      .where(and(eq(workCalendar.date, date), eq(workCalendar.isHoliday, true)));

    if (holidayCheck) {
      return NextResponse.json(
        { error: `Cannot create entries for ${date} - it is marked as a holiday (${holidayCheck.holidayNote || 'Holiday'})` },
        { status: 400 }
      );
    }

    // Active staff can receive new entries. Existing date entries remain editable so historical corrections work.
    const staffList = await db.select({
      id: staff.id,
      fullName: staff.fullName,
      active: staff.active,
      archived: staff.archived,
      isAttendanceOnly: staff.isAttendanceOnly,
      isNssPersonnel: staff.isNssPersonnel,
    }).from(staff);
    const staffMap = new Map(staffList.map(s => [s.id, s.fullName]));
    const staffPenaltyMap = new Map(staffList.map((s) => [s.id, s.isNssPersonnel === true]));
    const staffAttendanceOnlyMap = new Map(staffList.map((s) => [s.id, s.isAttendanceOnly === true]));
    const activeStaffIds = new Set(
      staffList
        .filter((s) => s.active === true && s.archived !== true)
        .map((s) => s.id),
    );
    const existingEntries = await db.select()
      .from(latenessEntry)
      .where(eq(latenessEntry.date, date));
    const existingByStaffId = new Map(existingEntries.map((entry) => [entry.staffId, entry]));
    const existingEntryStaffIds = new Set(existingEntries.map((entry) => entry.staffId));
    const allowedStaffIds = new Set([...activeStaffIds, ...existingEntryStaffIds]);
    const attendanceRows = await db.select()
      .from(attendanceRecord)
      .where(eq(attendanceRecord.date, date));
    const attendanceByStaffId = new Map(attendanceRows.map((record) => [record.staffId, record]));
    const activePermissionsByStaffId = await getActivePermissionsForDate(date);
    const actor = await getAuditActor();

    const results = [];
    let deletedCount = 0;
    let attendanceChangedCount = 0;
    const changedStaff = new Map<string, { fullName: string; staffId: string }>();
    const markStaffChanged = (staffId: string) => {
      changedStaff.set(staffId, {
        fullName: staffMap.get(staffId) || 'Unknown',
        staffId,
      });
    };

    for (const entry of entries) {
      if (!entry || typeof entry.staffId !== 'string' || !allowedStaffIds.has(entry.staffId)) {
        continue;
      }

      const arrivalTime = typeof entry.arrivalTime === 'string' && /^\d{2}:\d{2}$/.test(entry.arrivalTime)
        ? entry.arrivalTime
        : null;
      const existing = existingByStaffId.get(entry.staffId);
      const existingAttendance = attendanceByStaffId.get(entry.staffId);
      const existingReason = existing?.reason || (typeof entry.reason === 'string' ? entry.reason : '');
      const isNoShowSignInEntry =
        existingReason === NO_SHOW_SIGN_IN_REASON ||
        existingReason === NO_SHOW_SIGN_IN_WAIVED_REASON ||
        entry.noShowSignInWaived === true ||
        existingAttendance?.noShowSignInWaived === true;
      const hasSubmittedSignOutTime = hasOwn(entry, 'signOutTime');
      if (
        hasSubmittedSignOutTime &&
        typeof entry.signOutTime === 'string' &&
        entry.signOutTime.trim() !== '' &&
        !normalizeEntryTime(entry.signOutTime)
      ) {
        return NextResponse.json({ error: 'Invalid sign-out time format' }, { status: 400 });
      }

      const legacyNoSignOutToggle = entry.didNotSignOut === true && !hasSubmittedSignOutTime;
      const submittedSignOutTime = legacyNoSignOutToggle
        ? null
        : hasSubmittedSignOutTime
          ? normalizeEntryTime(entry.signOutTime)
          : normalizeEntryTime(existingAttendance?.signOutTime);
      const requestedNoSignOutWaived = legacyNoSignOutToggle
        ? false
        : hasOwn(entry, 'noSignOutWaived')
          ? entry.noSignOutWaived === true
          : existingAttendance?.noSignOutWaived === true;
      const requestedNoShowSignInWaived = hasOwn(entry, 'noShowSignInWaived')
        ? entry.noShowSignInWaived === true
        : existingAttendance?.noShowSignInWaived === true;
      const noShowSignInWaivedChanged =
        entry.noShowSignInWaivedChanged === true ||
        (hasOwn(entry, 'noShowSignInWaived') &&
          (existingAttendance?.noShowSignInWaived === true) !== requestedNoShowSignInWaived);

      if (isNoShowSignInEntry && noShowSignInWaivedChanged && !arrivalTime) {
        const attendanceValues: Partial<typeof attendanceRecord.$inferInsert> = {
          computedAmount: requestedNoShowSignInWaived ? '0.00' : NO_SHOW_SIGN_IN_AMOUNT.toFixed(2),
          noShowSignInWaived: requestedNoShowSignInWaived,
          noShowSignInWaivedAt: requestedNoShowSignInWaived ? new Date() : null,
          noShowSignInWaivedByEmail: requestedNoShowSignInWaived ? actor.actorEmail : null,
          noShowSignInWaivedByUserId: requestedNoShowSignInWaived ? actor.actorUserId : null,
          noShowSignInWaivedReason: requestedNoShowSignInWaived ? 'entries_no_show_sign_in_cleared' : null,
          reason: requestedNoShowSignInWaived ? NO_SHOW_SIGN_IN_WAIVED_REASON : null,
          status: requestedNoShowSignInWaived ? 'absent' : 'present',
          updatedAt: new Date(),
        };

        if (existingAttendance) {
          const [updatedAttendance] = await db.update(attendanceRecord)
            .set(attendanceValues)
            .where(eq(attendanceRecord.id, existingAttendance.id))
            .returning();

          if (updatedAttendance) {
            attendanceByStaffId.set(entry.staffId, updatedAttendance);
            await writeAuditEvent({
              entityType: 'attendance',
              entityId: updatedAttendance.id,
              action: 'UPDATE',
              before: existingAttendance,
              after: {
                ...updatedAttendance,
                staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
              },
              actor: { email: actor.actorEmail, id: actor.actorUserId },
              reason: 'entries',
            });
            attendanceChangedCount += 1;
          }
        } else if (requestedNoShowSignInWaived && activeStaffIds.has(entry.staffId)) {
          const [createdAttendance] = await db.insert(attendanceRecord)
            .values({
              staffId: entry.staffId,
              date,
              checkInAt: null,
              checkInTime: null,
              status: 'absent',
              source: 'no_show_sign_in_waiver',
              networkIp: 'no_show_sign_in_waiver',
              userAgent: request.headers.get('user-agent') || 'manual_entries',
              computedAmount: '0.00',
              reason: NO_SHOW_SIGN_IN_WAIVED_REASON,
              noShowSignInWaived: true,
              noShowSignInWaivedAt: new Date(),
              noShowSignInWaivedByEmail: actor.actorEmail,
              noShowSignInWaivedByUserId: actor.actorUserId,
              noShowSignInWaivedReason: 'entries_no_show_sign_in_cleared',
            })
            .returning();

          if (createdAttendance) {
            attendanceByStaffId.set(entry.staffId, createdAttendance);
            await writeAuditEvent({
              entityType: 'attendance',
              entityId: createdAttendance.id,
              action: 'CREATE',
              before: null,
              after: {
                ...createdAttendance,
                staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
              },
              actor: { email: actor.actorEmail, id: actor.actorUserId },
              reason: 'entries',
            });
            attendanceChangedCount += 1;
          }
        }

        const nextEntryValues = {
          arrivalTime: null,
          didNotSignOut: false,
          computedAmount: requestedNoShowSignInWaived ? '0.00' : NO_SHOW_SIGN_IN_AMOUNT.toFixed(2),
          reason: requestedNoShowSignInWaived ? NO_SHOW_SIGN_IN_WAIVED_REASON : NO_SHOW_SIGN_IN_REASON,
        };

        if (existing) {
          const before = { ...existing };
          const [result] = await db.update(latenessEntry)
            .set({ ...nextEntryValues, updatedAt: new Date() })
            .where(eq(latenessEntry.id, existing.id))
            .returning();

          if (result) {
            await writeAuditEvent({
              entityType: 'entry',
              entityId: result.id,
              action: 'UPDATE',
              before,
              after: {
                ...result,
                staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
              },
              reason: 'entries',
            });
            results.push(result);
          }
        } else {
          const [result] = await db.insert(latenessEntry)
            .values({
              staffId: entry.staffId,
              date,
              ...nextEntryValues,
            })
            .returning();

          if (result) {
            await writeAuditEvent({
              entityType: 'entry',
              entityId: result.id,
              action: 'CREATE',
              before: null,
              after: {
                ...result,
                staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
              },
              reason: 'entries',
            });
            results.push(result);
          }
        }

        markStaffChanged(entry.staffId);
        continue;
      }

      const didNotSignOut = submittedSignOutTime || requestedNoSignOutWaived
        ? false
        : entry.didNotSignOut === true;
      const activePermission = activePermissionsByStaffId.get(entry.staffId) || null;
      const penalty = resolveManualPenalty({
        activePermission,
        arrivalTime,
        didNotSignOut,
        isAttendanceOnly: staffAttendanceOnlyMap.get(entry.staffId) === true,
        isNssPersonnel: staffPenaltyMap.get(entry.staffId) === true,
      });

      const shouldStoreEntry = penalty.didNotSignOut || penalty.amount > 0;
      const signOutTimeChanged =
        entry.signOutTimeChanged === true ||
        (hasSubmittedSignOutTime &&
          normalizeEntryTime(existingAttendance?.signOutTime) !== submittedSignOutTime);
      const noSignOutWaivedChanged =
        entry.noSignOutWaivedChanged === true ||
        (hasOwn(entry, 'noSignOutWaived') &&
          (existingAttendance?.noSignOutWaived === true) !== requestedNoSignOutWaived);
      const didNotSignOutChanged =
        entry.didNotSignOutChanged === true ||
        (existing?.didNotSignOut === true) !== didNotSignOut;
      const signOutCorrection = submittedSignOutTime
        ? 'set'
        : (
          signOutTimeChanged ||
          (didNotSignOutChanged && didNotSignOut) ||
          (requestedNoSignOutWaived && Boolean(normalizeEntryTime(existingAttendance?.signOutTime)))
        )
          ? 'clear'
          : 'preserve';
      const shouldWaiveNoSignOut =
        !submittedSignOutTime &&
        (
          requestedNoSignOutWaived ||
          (didNotSignOutChanged && !didNotSignOut && !normalizeEntryTime(existingAttendance?.signOutTime))
        );
      const shouldClearNoSignOutWaiver = Boolean(submittedSignOutTime) || (
        !requestedNoSignOutWaived &&
        (noSignOutWaivedChanged || (didNotSignOutChanged && didNotSignOut))
      );

      if (existingAttendance) {
        const correction = resolveManualAttendanceCorrection({
          activePermission,
          attendance: existingAttendance,
          arrivalTime,
          date,
          didNotSignOut,
          isAttendanceOnly: staffAttendanceOnlyMap.get(entry.staffId) === true,
          isNssPersonnel: staffPenaltyMap.get(entry.staffId) === true,
          signOutCorrection,
          signOutTime: submittedSignOutTime,
        });
        const noSignOutWaiverChanged = (
          shouldWaiveNoSignOut &&
          (
            existingAttendance.noSignOutWaived !== true ||
            existingAttendance.noSignOutWaivedReason !== 'entries_no_sign_out_cleared'
          )
        ) || (
          shouldClearNoSignOutWaiver &&
          (
            existingAttendance.noSignOutWaived === true ||
            existingAttendance.noSignOutWaivedAt ||
            existingAttendance.noSignOutWaivedByEmail ||
            existingAttendance.noSignOutWaivedByUserId ||
            existingAttendance.noSignOutWaivedReason
          )
        );

        if (manualAttendanceCorrectionChanged({
          attendance: existingAttendance,
          correction,
        }) || noSignOutWaiverChanged) {
          const attendanceUpdateValues: Partial<typeof attendanceRecord.$inferInsert> = {
            checkInAt: correction.checkInAt,
            checkInTime: correction.checkInTime,
            computedAmount: correction.computedAmount,
            reason: correction.reason,
            status: correction.status,
            updatedAt: new Date(),
          };

          if (Object.prototype.hasOwnProperty.call(correction, 'signOutTime')) {
            attendanceUpdateValues.signOutAt = correction.signOutAt;
            attendanceUpdateValues.signOutTime = correction.signOutTime;
            attendanceUpdateValues.signOutNetworkIp = correction.signOutTime ? 'manual_admin' : null;
            attendanceUpdateValues.signOutUserAgent = correction.signOutTime
              ? request.headers.get('user-agent') || 'manual_entries'
              : null;
          }

          if (shouldWaiveNoSignOut) {
            attendanceUpdateValues.noSignOutWaived = true;
            attendanceUpdateValues.noSignOutWaivedAt = new Date();
            attendanceUpdateValues.noSignOutWaivedByEmail = actor.actorEmail;
            attendanceUpdateValues.noSignOutWaivedByUserId = actor.actorUserId;
            attendanceUpdateValues.noSignOutWaivedReason = 'entries_no_sign_out_cleared';
          } else if (shouldClearNoSignOutWaiver) {
            attendanceUpdateValues.noSignOutWaived = false;
            attendanceUpdateValues.noSignOutWaivedAt = null;
            attendanceUpdateValues.noSignOutWaivedByEmail = null;
            attendanceUpdateValues.noSignOutWaivedByUserId = null;
            attendanceUpdateValues.noSignOutWaivedReason = null;
          }

          const [updatedAttendance] = await db.update(attendanceRecord)
            .set(attendanceUpdateValues)
            .where(eq(attendanceRecord.id, existingAttendance.id))
            .returning();

          if (updatedAttendance) {
            attendanceByStaffId.set(entry.staffId, updatedAttendance);

            await writeAuditEvent({
              entityType: 'attendance',
              entityId: updatedAttendance.id,
              action: 'UPDATE',
              before: existingAttendance,
              after: {
                ...updatedAttendance,
                source: 'entries_manual_correction',
                staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
              },
              actor: { email: actor.actorEmail, id: actor.actorUserId },
              reason: 'entries',
            });
            attendanceChangedCount += 1;
            markStaffChanged(entry.staffId);
          }
        }
      } else if (arrivalTime && activeStaffIds.has(entry.staffId)) {
        const manualAttendanceValues = {
          staffId: entry.staffId,
          date,
          checkInAt: buildManualCheckInAt(date, arrivalTime),
          checkInTime: arrivalTime,
          status: penalty.status,
          source: 'entries_manual_check_in',
          networkIp: 'manual_admin',
          userAgent: request.headers.get('user-agent') || 'manual_entries',
          computedAmount: penalty.amount.toFixed(2),
          reason: penalty.reason,
          ...(submittedSignOutTime ? {
            signOutAt: buildManualSignOutAt(date, submittedSignOutTime),
            signOutTime: submittedSignOutTime,
            signOutNetworkIp: 'manual_admin',
            signOutUserAgent: request.headers.get('user-agent') || 'manual_entries',
          } : {}),
          ...(shouldWaiveNoSignOut ? {
            noSignOutWaived: true,
            noSignOutWaivedAt: new Date(),
            noSignOutWaivedByEmail: actor.actorEmail,
            noSignOutWaivedByUserId: actor.actorUserId,
            noSignOutWaivedReason: 'entries_no_sign_out_cleared',
          } : {}),
        };
        const [createdAttendance] = await db.insert(attendanceRecord)
          .values(manualAttendanceValues)
          .returning();

        if (createdAttendance) {
          attendanceByStaffId.set(entry.staffId, createdAttendance);

          await writeAuditEvent({
            entityType: 'attendance',
            entityId: createdAttendance.id,
            action: 'CREATE',
            before: null,
            after: {
              ...createdAttendance,
              staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
            },
            actor: { email: actor.actorEmail, id: actor.actorUserId },
            reason: 'entries',
          });
          attendanceChangedCount += 1;
          markStaffChanged(entry.staffId);
        }
      }

      if (!shouldStoreEntry) {
        if (existing) {
          await db.delete(latenessEntry).where(eq(latenessEntry.id, existing.id));
          await writeAuditEvent({
            entityType: 'entry',
            entityId: existing.id,
            action: 'DELETE',
            before: {
              ...existing,
              staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
            },
            after: null,
            reason: 'entries',
          });
          deletedCount += 1;
          markStaffChanged(entry.staffId);
        }
        continue;
      }

      let result;
      if (existing) {
        const before = { ...existing };
        const nextValues = {
          arrivalTime,
          didNotSignOut: penalty.didNotSignOut,
          computedAmount: penalty.amount.toString(),
          reason: penalty.reason,
        };

        if (latenessEntryChanged({ existing, next: nextValues })) {
          [result] = await db.update(latenessEntry)
            .set({
              ...nextValues,
              updatedAt: new Date(),
            })
            .where(eq(latenessEntry.id, existing.id))
            .returning();

          await writeAuditEvent({
            entityType: 'entry',
            entityId: result.id,
            action: 'UPDATE',
            before,
            after: {
              ...result,
              staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
            },
            reason: 'entries',
          });
          results.push(result);
          markStaffChanged(entry.staffId);
        }
      } else {
        [result] = await db.insert(latenessEntry).values({
          staffId: entry.staffId,
          date: date,
          arrivalTime,
          didNotSignOut: penalty.didNotSignOut,
          computedAmount: penalty.amount.toString(),
          reason: penalty.reason,
        }).returning();

        await writeAuditEvent({
          entityType: 'entry',
          entityId: result.id,
          action: 'CREATE',
          before: null,
          after: {
            ...result,
            staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
          },
          reason: 'entries',
        });
        results.push(result);
        markStaffChanged(entry.staffId);
      }
    }

    const [existingSubmission] = await db.select()
      .from(entrySubmission)
      .where(eq(entrySubmission.date, date))
      .limit(1);
    const now = new Date();
    const [submission] = await db.insert(entrySubmission)
      .values({
        date,
        submittedByUserId: actor.actorUserId,
        submittedByEmail: actor.actorEmail,
        entryCount: results.length,
        deletedCount,
        submittedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: entrySubmission.date,
        set: {
          submittedByUserId: actor.actorUserId,
          submittedByEmail: actor.actorEmail,
          entryCount: results.length,
          deletedCount,
          submittedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await writeAuditEvent({
      entityType: 'entry_submission',
      entityId: date,
      action: existingSubmission ? 'UPDATE' : 'CREATE',
      before: existingSubmission || null,
      after: submission,
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'entries',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'entries' });
    publishRealtime('attendance', 'invalidate', { reason: 'entries' });
    publishRealtime('entries', 'invalidate', { reason: 'entries' });
    publishRealtime('payments', 'invalidate', { date, reason: 'entries' });
    publishRealtime('staff-penalty-history', 'invalidate', { date, reason: 'entries' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'entries' });

    const changedStaffList = Array.from(changedStaff.values());

    return NextResponse.json({
      success: true,
      count: results.length,
      attendanceCount: attendanceChangedCount,
      changedStaff: changedStaffList,
      changedStaffCount: changedStaffList.length,
      changedStaffNames: changedStaffList.map((member) => member.fullName),
      deletedCount,
      submittedAt: submission?.submittedAt,
    });
  } catch (error) {
    console.error('Failed to save entries:', error);
    return NextResponse.json({ error: 'Failed to save entries' }, { status: 500 });
  }
}
