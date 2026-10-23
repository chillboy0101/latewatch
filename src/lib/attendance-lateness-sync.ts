import 'server-only';

import { and, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry, staff } from '@/db/schema';
import { getAccraClock, getHolidayDatesForRange, getHolidayForDate, isWeekendDate } from '@/lib/attendance';
import { resolveManualPenalty } from '@/lib/manual-attendance-correction';
import {
  getFinanciallyAllocatedEntryIds,
  getFinanciallyProtectedLeaveEntryIds,
  getStaffLeavePeriodsForRange,
} from '@/lib/staff-leave-service';
import { penaltyFlagsOn } from '@/lib/staff-type';
import { getStaffTypeChanges } from '@/lib/staff-type-history';
import { isStaffLeaveDate } from '@/lib/staff-leave';
import { getAccraDateKey } from '@/lib/date-key';
import {
  deleteUnsettledLatenessEntry,
  updateUnpaidLatenessEntry,
  updateUnsettledLatenessEntry,
} from '@/lib/lateness-entry-writes';
import { NO_SHOW_SIGN_IN_CUTOFF_TIME, shouldAlertNoSignOut } from '@/lib/work-hours';
import {
  chargesNoSignOut,
  NO_SHOW_SIGN_IN_EFFECTIVE_DATE,
  NO_SHOW_SIGN_IN_REASON,
  NO_SHOW_SIGN_IN_WAIVED_REASON,
} from '@/lib/penalty-calculator';

function enumerateDateKeys(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate;) {
    dates.push(current);
    const next = new Date(`${current}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    current = next.toISOString().slice(0, 10);
  }
  return dates;
}

function normalizeDateKey(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

function normalizeTimeKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const time = value.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function amountNumber(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function amountText(value: number) {
  return value.toFixed(2);
}

function isLegacyEntriesFallbackSignOut(input: {
  signOutNetworkIp?: string | null;
  signOutTime?: string | null;
}) {
  return normalizeTimeKey(input.signOutTime) === '17:00' && input.signOutNetworkIp === 'manual_admin';
}

function rowKey(staffId: string, date: string) {
  return `${staffId}:${date}`;
}

/** The first day a staff member can be charged a no-show: the Accra day their record was created. */
function chargeableFromDate(createdAt: Date | null | undefined) {
  return createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? getAccraDateKey(createdAt) : '';
}

// Nobody is charged for a day on approved leave (leave is often entered after the fact). A paid
// day is never touched; a pardoned one is set to no charge (the pardon ledger keeps the history).
async function clearUnprotectedLeavePenalty(input: {
  attendance?: { computedAmount: string | number | null; id: string } | null;
  entries: Array<{ computedAmount?: string | number | null; id: string }>;
  paidEntryIds: Set<string>;
  protectedEntryIds: Set<string>;
}) {
  if (input.entries.some((entry) => input.paidEntryIds.has(entry.id))) {
    return { attendanceUpdated: 0, deleted: 0 };
  }

  let attendanceUpdated = 0;
  if (input.attendance && amountNumber(input.attendance.computedAmount) > 0) {
    await db.update(attendanceRecord)
      .set({ computedAmount: '0.00', reason: null, updatedAt: new Date() })
      .where(eq(attendanceRecord.id, input.attendance.id));
    attendanceUpdated = 1;
  }

  let deleted = 0;
  for (const entry of input.entries) {
    if (input.protectedEntryIds.has(entry.id)) {
      if (amountNumber(entry.computedAmount) > 0) {
        await updateUnpaidLatenessEntry(entry.id, { computedAmount: '0.00', didNotSignOut: false, reason: 'On approved leave', updatedAt: new Date() });
      }
      continue;
    }
    deleted += await deleteUnsettledLatenessEntry(entry.id);
  }

  return { attendanceUpdated, deleted };
}

function shouldApplyNoSignOutPenalty(input: {
  checkInTime: string | null;
  date: string;
  existingDidNotSignOut: boolean;
  noSignOutWaived: boolean;
  signOutTime: string | null;
}) {
  if (!chargesNoSignOut(input.date)) return false;
  if (input.noSignOutWaived) return false;
  if (!input.checkInTime || input.signOutTime) return false;
  if (input.existingDidNotSignOut) return true;

  const clock = getAccraClock();
  if (input.date < clock.dateKey) return true;
  if (input.date > clock.dateKey) return false;
  return shouldAlertNoSignOut(clock.timeKey);
}

function shouldApplyNoShowSignInPenalty(input: {
  currentDateKey: string;
  currentTimeKey: string;
  date: string;
}) {
  if (input.date < NO_SHOW_SIGN_IN_EFFECTIVE_DATE) return false;
  if (input.date < input.currentDateKey) return true;
  if (input.date > input.currentDateKey) return false;
  return input.currentTimeKey.slice(0, 5) >= NO_SHOW_SIGN_IN_CUTOFF_TIME;
}

export async function syncLatenessEntriesFromAttendanceForDate(dateKey: string) {
  return syncLatenessEntriesFromAttendanceForRange(dateKey, dateKey);
}

export async function applyNoShowSignInPenaltiesForDate(dateKey: string) {
  const isWeekend = typeof isWeekendDate === 'function'
    ? isWeekendDate(dateKey)
    : [0, 6].includes(new Date(`${dateKey}T00:00:00Z`).getUTCDay());
  const holiday = typeof getHolidayForDate === 'function'
    ? await getHolidayForDate(dateKey)
    : null;
  if (isWeekend || holiday) {
    return { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
  }

  const clock = getAccraClock();
  if (!shouldApplyNoShowSignInPenalty({
    currentDateKey: clock.dateKey,
    currentTimeKey: clock.timeKey,
    date: dateKey,
  })) {
    return { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
  }

  const staffRows = await db.select({
    createdAt: staff.createdAt,
    id: staff.id,
    isAttendanceOnly: staff.isAttendanceOnly,
    isNssPersonnel: staff.isNssPersonnel,
  })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)));
  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
    computedAmount: attendanceRecord.computedAmount,
    date: attendanceRecord.date,
    id: attendanceRecord.id,
    noShowSignInWaived: attendanceRecord.noShowSignInWaived,
    source: attendanceRecord.source,
    staffId: attendanceRecord.staffId,
  })
    .from(attendanceRecord)
    .where(eq(attendanceRecord.date, dateKey));
  const attendanceByStaffId = new Map(attendanceRows.map((row) => [row.staffId, row]));
  const permissionRows = await db.select()
    .from(attendancePermission)
    .where(and(
      eq(attendancePermission.date, dateKey),
      or(eq(attendancePermission.status, 'approved'), isNotNull(attendancePermission.generalPardonType)),
    ));
  const permissionsByStaffId = new Map(permissionRows.map((permission) => [permission.staffId, permission]));
  const existingRows = await db.select()
    .from(latenessEntry)
    .where(eq(latenessEntry.date, dateKey));
  const leavePeriods = await getStaffLeavePeriodsForRange({
    endDate: dateKey,
    staffIds: staffRows.map((member) => member.id),
    startDate: dateKey,
  });
  const typeChanges = await getStaffTypeChanges(staffRows.map((member) => member.id));
  const protectedEntryIds = await getFinanciallyProtectedLeaveEntryIds(existingRows.map((entry) => entry.id));
  const paidEntryIds = await getFinanciallyAllocatedEntryIds(existingRows.map((entry) => entry.id));
  const existingByStaffId = new Map(existingRows.map((entry) => [entry.staffId, entry]));

  let deleted = 0;
  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const member of staffRows) {
    if (isStaffLeaveDate(leavePeriods, member.id, dateKey)) {
      const existing = existingByStaffId.get(member.id);
      const result = await clearUnprotectedLeavePenalty({
        attendance: attendanceByStaffId.get(member.id) || null,
        entries: existing ? [existing] : [],
        paidEntryIds,
        protectedEntryIds,
      });
      deleted += result.deleted;
      updated += result.attendanceUpdated;
      skipped += 1;
      continue;
    }

    // The type on that day: someone who was an intern or away then is never charged for it.
    const flags = penaltyFlagsOn(dateKey, typeChanges.get(member.id), member);
    if (flags.isAttendanceOnly || dateKey < chargeableFromDate(member.createdAt)) {
      skipped += 1;
      continue;
    }

    const attendance = attendanceByStaffId.get(member.id);
    if (attendance?.noShowSignInWaived === true) {
      skipped += 1;
      continue;
    }

    if (attendance && normalizeTimeKey(attendance.checkInTime)) {
      skipped += 1;
      continue;
    }

    const permission = permissionsByStaffId.get(member.id);
    if (permission?.permissionType === 'absence') {
      skipped += 1;
      continue;
    }

    const penalty = resolveManualPenalty({
      activePermission: permission || null,
      arrivalTime: null,
      date: dateKey,
      didNotSignOut: false,
      isAttendanceOnly: false,
      isNssPersonnel: flags.isNssPersonnel,
      noSignIn: true,
    });
    if (penalty.amount <= 0) {
      skipped += 1;
      continue;
    }

    const existing = existingByStaffId.get(member.id);
    if (existing && protectedEntryIds.has(existing.id)) {
      skipped += 1;
      continue;
    }
    const computedAmount = amountText(penalty.amount);
    if (existing) {
      if (
        amountText(amountNumber(existing.computedAmount)) === computedAmount &&
        normalizeTimeKey(existing.arrivalTime) === null &&
        existing.didNotSignOut !== true &&
        existing.reason === NO_SHOW_SIGN_IN_REASON
      ) {
        skipped += 1;
        continue;
      }

      if (existing.reason === NO_SHOW_SIGN_IN_WAIVED_REASON) {
        skipped += 1;
        continue;
      }

      if (await updateUnsettledLatenessEntry(existing.id, {
        arrivalTime: null,
        computedAmount,
        didNotSignOut: false,
        reason: NO_SHOW_SIGN_IN_REASON,
        updatedAt: new Date(),
      })) updated += 1;
      continue;
    }

    await db.insert(latenessEntry)
      .values({
        arrivalTime: null,
        computedAmount,
        date: dateKey,
        didNotSignOut: false,
        reason: NO_SHOW_SIGN_IN_REASON,
        staffId: member.id,
      })
      .onConflictDoNothing();
    inserted += 1;
  }

  return { deleted, inserted, skipped, updated };
}

export async function applyNoShowSignInPenaltiesForRange(startDate: string, endDate: string) {
  const clock = getAccraClock();
  const candidateDates = enumerateDateKeys(startDate, endDate).filter((date) => {
    if (typeof isWeekendDate === 'function' && isWeekendDate(date)) return false;
    return shouldApplyNoShowSignInPenalty({
      currentDateKey: clock.dateKey,
      currentTimeKey: clock.timeKey,
      date,
    });
  });

  if (candidateDates.length === 0) {
    return { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
  }

  const holidayDates = await getHolidayDatesForRange(startDate, endDate);
  const workingDates = candidateDates.filter((date) => !holidayDates.has(date));

  if (workingDates.length === 0) {
    return { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
  }

  const staffRows = await db.select({
    createdAt: staff.createdAt,
    id: staff.id,
    isAttendanceOnly: staff.isAttendanceOnly,
    isNssPersonnel: staff.isNssPersonnel,
  })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)));

  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
    computedAmount: attendanceRecord.computedAmount,
    date: attendanceRecord.date,
    id: attendanceRecord.id,
    noShowSignInWaived: attendanceRecord.noShowSignInWaived,
    source: attendanceRecord.source,
    staffId: attendanceRecord.staffId,
  })
    .from(attendanceRecord)
    .where(and(gte(attendanceRecord.date, startDate), lte(attendanceRecord.date, endDate)));
  const attendanceByKey = new Map(
    attendanceRows.map((row) => [rowKey(row.staffId, normalizeDateKey(row.date)), row]),
  );

  const permissionRows = await db.select()
    .from(attendancePermission)
    .where(and(
      gte(attendancePermission.date, startDate),
      lte(attendancePermission.date, endDate),
      or(eq(attendancePermission.status, 'approved'), isNotNull(attendancePermission.generalPardonType)),
    ));
  const permissionsByKey = new Map(
    permissionRows.map((row) => [rowKey(row.staffId, normalizeDateKey(row.date)), row]),
  );

  const existingRows = await db.select()
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, startDate), lte(latenessEntry.date, endDate)));
  const leavePeriods = await getStaffLeavePeriodsForRange({ endDate, staffIds: staffRows.map((member) => member.id), startDate });
  const typeChanges = await getStaffTypeChanges(staffRows.map((member) => member.id));
  const protectedEntryIds = await getFinanciallyProtectedLeaveEntryIds(existingRows.map((entry) => entry.id));
  const paidEntryIds = await getFinanciallyAllocatedEntryIds(existingRows.map((entry) => entry.id));
  const existingByKey = new Map(
    existingRows.map((row) => [rowKey(row.staffId, normalizeDateKey(row.date)), row]),
  );

  let deleted = 0;
  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const date of workingDates) {
    for (const member of staffRows) {
      if (isStaffLeaveDate(leavePeriods, member.id, date)) {
        const existing = existingByKey.get(rowKey(member.id, date));
        const result = await clearUnprotectedLeavePenalty({
          entries: existing ? [existing] : [],
          paidEntryIds,
          protectedEntryIds,
        });
        deleted += result.deleted;
        skipped += 1;
        continue;
      }

      const flags = penaltyFlagsOn(date, typeChanges.get(member.id), member);
      if (flags.isAttendanceOnly || date < chargeableFromDate(member.createdAt)) {
        skipped += 1;
        continue;
      }

      const key = rowKey(member.id, date);
      const attendance = attendanceByKey.get(key);
      if (attendance?.noShowSignInWaived === true) {
        skipped += 1;
        continue;
      }
      if (attendance && normalizeTimeKey(attendance.checkInTime)) {
        skipped += 1;
        continue;
      }

      const permission = permissionsByKey.get(key);
      if (
        permission?.generalPardonType === 'absence' ||
        (permission?.status === 'approved' && permission.permissionType === 'absence')
      ) {
        skipped += 1;
        continue;
      }

      const penalty = resolveManualPenalty({
        activePermission: permission || null,
        arrivalTime: null,
        date,
        didNotSignOut: false,
        isAttendanceOnly: false,
        isNssPersonnel: flags.isNssPersonnel,
        noSignIn: true,
      });
      if (penalty.amount <= 0) {
        skipped += 1;
        continue;
      }

      const existing = existingByKey.get(key);
      if (existing && protectedEntryIds.has(existing.id)) {
        skipped += 1;
        continue;
      }
      const computedAmount = amountText(penalty.amount);
      if (existing) {
        if (
          amountText(amountNumber(existing.computedAmount)) === computedAmount &&
          normalizeTimeKey(existing.arrivalTime) === null &&
          existing.didNotSignOut !== true &&
          existing.reason === NO_SHOW_SIGN_IN_REASON
        ) {
          skipped += 1;
          continue;
        }

        if (existing.reason === NO_SHOW_SIGN_IN_WAIVED_REASON) {
          skipped += 1;
          continue;
        }

        if (await updateUnsettledLatenessEntry(existing.id, {
          arrivalTime: null,
          computedAmount,
          didNotSignOut: false,
          reason: NO_SHOW_SIGN_IN_REASON,
          updatedAt: new Date(),
        })) updated += 1;
        continue;
      }

      await db.insert(latenessEntry)
        .values({
          arrivalTime: null,
          computedAmount,
          date,
          didNotSignOut: false,
          reason: NO_SHOW_SIGN_IN_REASON,
          staffId: member.id,
        })
        .onConflictDoNothing();
      inserted += 1;
    }
  }

  return { deleted, inserted, skipped, updated };
}

export async function syncLatenessEntriesFromAttendanceForRange(startDate: string, endDate: string) {
  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
    computedAmount: attendanceRecord.computedAmount,
    date: attendanceRecord.date,
    id: attendanceRecord.id,
    reason: attendanceRecord.reason,
    isAttendanceOnly: staff.isAttendanceOnly,
    isNssPersonnel: staff.isNssPersonnel,
    noSignOutWaived: attendanceRecord.noSignOutWaived,
    noSignOutWaivedAt: attendanceRecord.noSignOutWaivedAt,
    noSignOutWaivedByEmail: attendanceRecord.noSignOutWaivedByEmail,
    noSignOutWaivedByUserId: attendanceRecord.noSignOutWaivedByUserId,
    noSignOutWaivedReason: attendanceRecord.noSignOutWaivedReason,
    signOutNetworkIp: attendanceRecord.signOutNetworkIp,
    signOutTime: attendanceRecord.signOutTime,
    staffId: attendanceRecord.staffId,
    staffName: staff.fullName,
    status: attendanceRecord.status,
  })
    .from(attendanceRecord)
    .leftJoin(staff, eq(staff.id, attendanceRecord.staffId))
    .where(and(gte(attendanceRecord.date, startDate), lte(attendanceRecord.date, endDate)));

  const permissionRows = await db.select()
    .from(attendancePermission)
    .where(and(
      gte(attendancePermission.date, startDate),
      lte(attendancePermission.date, endDate),
      or(eq(attendancePermission.status, 'approved'), isNotNull(attendancePermission.generalPardonType)),
    ));
  const permissionsByStaffDate = new Map(
    permissionRows.map((permission) => [
      rowKey(permission.staffId, normalizeDateKey(permission.date)),
      permission,
    ]),
  );
  const existingRows = await db.select()
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, startDate), lte(latenessEntry.date, endDate)));
  const leavePeriods = await getStaffLeavePeriodsForRange({ endDate, startDate });
  const typeChanges = await getStaffTypeChanges([
    ...attendanceRows.map((row) => row.staffId),
    ...existingRows.map((entry) => entry.staffId),
  ]);
  const existingEntryIds = existingRows.map((entry) => entry.id);
  // Paid and pardoned entries are settled: the sync never rewrites or deletes them.
  const protectedEntryIds = await getFinanciallyProtectedLeaveEntryIds(existingEntryIds);
  const paidEntryIds = await getFinanciallyAllocatedEntryIds(existingEntryIds);
  const holidayDates = await getHolidayDatesForRange(startDate, endDate);
  const existingByStaffDate = new Map<string, typeof existingRows>();
  for (const entry of existingRows) {
    const key = rowKey(entry.staffId, normalizeDateKey(entry.date));
    const list = existingByStaffDate.get(key) || [];
    list.push(entry);
    existingByStaffDate.set(key, list);
  }

  const processedKeys = new Set<string>();
  let deleted = 0;
  let inserted = 0;
  let attendanceUpdated = 0;
  let skipped = 0;
  let updated = 0;

  for (const row of attendanceRows) {
    const date = normalizeDateKey(row.date);
    const arrivalTime = normalizeTimeKey(row.checkInTime);
    if (!date || !row.staffId) continue;

    const key = rowKey(row.staffId, date);
    const existingEntriesForKey = existingByStaffDate.get(key) || [];
    const existing = existingEntriesForKey[0] || null;
    if (isStaffLeaveDate(leavePeriods, row.staffId, date)) {
      processedKeys.add(key);
      const result = await clearUnprotectedLeavePenalty({
        attendance: row,
        entries: existingEntriesForKey,
        paidEntryIds,
        protectedEntryIds,
      });
      deleted += result.deleted;
      attendanceUpdated += result.attendanceUpdated;
      continue;
    }
    // No check-in and a no-show charge (or waiver): that belongs to the no-show pass below.
    if (!arrivalTime && existingEntriesForKey.some((entry) => entry.reason === NO_SHOW_SIGN_IN_REASON || entry.reason === NO_SHOW_SIGN_IN_WAIVED_REASON)) {
      processedKeys.add(key);
      skipped += 1;
      continue;
    }
    const activePermission = permissionsByStaffDate.get(key) || null;
    const hasLegacyEntriesFallbackSignOut = isLegacyEntriesFallbackSignOut(row);
    const noSignOutWaived = row.noSignOutWaived === true || hasLegacyEntriesFallbackSignOut;
    const signOutTime = hasLegacyEntriesFallbackSignOut
      ? null
      : normalizeTimeKey(row.signOutTime);
    const didNotSignOut = shouldApplyNoSignOutPenalty({
      checkInTime: normalizeTimeKey(row.checkInTime),
      date,
      existingDidNotSignOut: existing?.didNotSignOut === true,
      noSignOutWaived,
      signOutTime,
    });
    // A holiday declared after people signed in: nobody is charged for that day.
    const penalty = holidayDates.has(date)
      ? { amount: 0, didNotSignOut: false, reason: '', status: 'present' as const }
      : resolveManualPenalty({
        activePermission,
        arrivalTime,
        date,
        didNotSignOut,
        ...penaltyFlagsOn(date, typeChanges.get(row.staffId), row),
      });
    const computedAmount = amountText(penalty.amount);
    const attendanceReason = penalty.reason || null;
    const reason = penalty.reason || row.reason || 'Late arrival';

    processedKeys.add(key);

    if (existingEntriesForKey.some((entry) => protectedEntryIds.has(entry.id))) {
      // The money is settled; only the day's status (late / on time) may still need correcting.
      if ((row.status || null) !== penalty.status) {
        await db.update(attendanceRecord)
          .set({ status: penalty.status, updatedAt: new Date() })
          .where(eq(attendanceRecord.id, row.id));
        attendanceUpdated += 1;
      }
      skipped += 1;
      continue;
    }

    const attendanceAmount = amountText(amountNumber(row.computedAmount));
    const needsPenaltyAttendanceUpdate =
      attendanceAmount !== computedAmount ||
      (row.reason || null) !== attendanceReason ||
      (row.status || null) !== penalty.status ||
      (hasLegacyEntriesFallbackSignOut && row.noSignOutWaived !== true);

    if (needsPenaltyAttendanceUpdate || hasLegacyEntriesFallbackSignOut) {
      const waiverValues = hasLegacyEntriesFallbackSignOut
        ? {
            noSignOutWaived: true,
            noSignOutWaivedAt: new Date(),
            noSignOutWaivedByEmail: 'system',
            noSignOutWaivedByUserId: null,
            noSignOutWaivedReason: 'legacy_entries_fallback_sign_out',
          }
        : {};

      await db.update(attendanceRecord)
        .set({
          computedAmount,
          reason: attendanceReason,
          ...(hasLegacyEntriesFallbackSignOut
            ? {
                signOutAccuracyMeters: null,
                signOutAt: null,
                signOutDistanceMeters: null,
                signOutLatitude: null,
                signOutLocationAt: null,
                signOutLocationVerified: false,
                signOutLongitude: null,
                signOutNetworkIp: null,
                signOutOfficeLocationId: null,
                signOutTime: null,
                signOutUserAgent: null,
                signOutVerificationResult: null,
                ...waiverValues,
              }
            : {}),
          status: penalty.status,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecord.id, row.id));
      attendanceUpdated += 1;
    }

    if (penalty.amount <= 0) {
      for (const staleEntry of existingEntriesForKey) {
        deleted += await deleteUnsettledLatenessEntry(staleEntry.id);
      }
      continue;
    }

    if (existing) {
      for (const duplicateEntry of existingEntriesForKey.slice(1)) {
        deleted += await deleteUnsettledLatenessEntry(duplicateEntry.id);
      }
      const existingAmount = amountText(amountNumber(existing.computedAmount));
      const needsUpdate =
        normalizeTimeKey(existing.arrivalTime) !== arrivalTime ||
        existingAmount !== computedAmount ||
        (existing.reason || '') !== reason ||
        existing.didNotSignOut !== penalty.didNotSignOut;

      if (!needsUpdate) continue;

      if (await updateUnsettledLatenessEntry(existing.id, {
        arrivalTime,
        computedAmount,
        didNotSignOut: penalty.didNotSignOut,
        reason,
        updatedAt: new Date(),
      })) updated += 1;
      continue;
    }

    await db.insert(latenessEntry)
      .values({
        arrivalTime,
        computedAmount,
        date,
        didNotSignOut: penalty.didNotSignOut,
        reason,
        staffId: row.staffId,
      })
      .onConflictDoNothing();
    inserted += 1;
  }

  const unprocessedStaffIds = [...new Set(existingRows
    .filter((entry) => !processedKeys.has(rowKey(entry.staffId, normalizeDateKey(entry.date))))
    .map((entry) => entry.staffId))];
  const staffFlagRows = unprocessedStaffIds.length === 0
    ? []
    : await db.select({ id: staff.id, isAttendanceOnly: staff.isAttendanceOnly, isNssPersonnel: staff.isNssPersonnel })
      .from(staff)
      .where(inArray(staff.id, unprocessedStaffIds));
  const staffFlagsById = new Map(staffFlagRows.map((member) => [member.id, member]));

  for (const existing of existingRows) {
    const date = normalizeDateKey(existing.date);
    const key = rowKey(existing.staffId, date);
    if (processedKeys.has(key)) continue;
    if (isStaffLeaveDate(leavePeriods, existing.staffId, date)) {
      const result = await clearUnprotectedLeavePenalty({
        entries: [existing],
        paidEntryIds,
        protectedEntryIds,
      });
      deleted += result.deleted;
      continue;
    }
    if (protectedEntryIds.has(existing.id)) {
      skipped += 1;
      continue;
    }
    // A no-show charged before the day was declared a holiday.
    if (holidayDates.has(date) && existing.reason === NO_SHOW_SIGN_IN_REASON) {
      deleted += await deleteUnsettledLatenessEntry(existing.id);
      continue;
    }
    if (existing.reason === NO_SHOW_SIGN_IN_REASON || existing.reason === NO_SHOW_SIGN_IN_WAIVED_REASON) continue;

    const activePermission = permissionsByStaffDate.get(key) || null;
    if (!activePermission) continue;

    const flags = penaltyFlagsOn(date, typeChanges.get(existing.staffId), staffFlagsById.get(existing.staffId) || {});
    const penalty = resolveManualPenalty({
      activePermission,
      arrivalTime: normalizeTimeKey(existing.arrivalTime),
      date,
      didNotSignOut: existing.didNotSignOut === true,
      ...flags,
    });
    const computedAmount = amountText(penalty.amount);

    if (penalty.amount <= 0) {
      deleted += await deleteUnsettledLatenessEntry(existing.id);
      continue;
    }

    const existingAmount = amountText(amountNumber(existing.computedAmount));
    if (
      existingAmount === computedAmount &&
      existing.reason === penalty.reason &&
      existing.didNotSignOut === penalty.didNotSignOut
    ) {
      continue;
    }

    if (await updateUnsettledLatenessEntry(existing.id, {
      computedAmount,
      didNotSignOut: penalty.didNotSignOut,
      reason: penalty.reason || existing.reason || 'Late arrival',
      updatedAt: new Date(),
    })) updated += 1;
  }

  const noShowSignInResult = await applyNoShowSignInPenaltiesForRange(startDate, endDate);
  deleted += noShowSignInResult.deleted;
  inserted += noShowSignInResult.inserted;
  updated += noShowSignInResult.updated;

  return { attendanceUpdated, deleted, inserted, skipped, updated };
}
