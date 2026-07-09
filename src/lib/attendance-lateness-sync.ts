import 'server-only';

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry, staff, workCalendar } from '@/db/schema';
import { getAccraClock, getHolidayForDate, isWeekendDate } from '@/lib/attendance';
import { getObservedGhanaHolidayForDate, isSuppressedGhanaHolidayDate } from '@/lib/ghana-holidays';
import { resolveManualPenalty } from '@/lib/manual-attendance-correction';
import { NO_SHOW_SIGN_IN_CUTOFF_TIME, shouldAlertNoSignOut } from '@/lib/work-hours';
import {
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

function shouldApplyNoSignOutPenalty(input: {
  checkInTime: string | null;
  date: string;
  existingDidNotSignOut: boolean;
  noSignOutWaived: boolean;
  signOutTime: string | null;
}) {
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
    id: staff.id,
    isAttendanceOnly: staff.isAttendanceOnly,
    isNssPersonnel: staff.isNssPersonnel,
  })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)));
  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
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
    .where(and(eq(attendancePermission.date, dateKey), eq(attendancePermission.status, 'approved')));
  const permissionsByStaffId = new Map(permissionRows.map((permission) => [permission.staffId, permission]));
  const existingRows = await db.select()
    .from(latenessEntry)
    .where(eq(latenessEntry.date, dateKey));
  const existingByStaffId = new Map(existingRows.map((entry) => [entry.staffId, entry]));

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const member of staffRows) {
    if (member.isAttendanceOnly === true) {
      skipped += 1;
      continue;
    }

    const attendance = attendanceByStaffId.get(member.id);
    if (attendance?.noShowSignInWaived === true || attendance?.source === 'no_show_sign_in_waiver') {
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
      didNotSignOut: false,
      isAttendanceOnly: false,
      isNssPersonnel: member.isNssPersonnel === true,
      noSignIn: true,
    });
    if (penalty.amount <= 0) {
      skipped += 1;
      continue;
    }

    const existing = existingByStaffId.get(member.id);
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

      await db.update(latenessEntry)
        .set({
          arrivalTime: null,
          computedAmount,
          didNotSignOut: false,
          reason: NO_SHOW_SIGN_IN_REASON,
          updatedAt: new Date(),
        })
        .where(eq(latenessEntry.id, existing.id));
      updated += 1;
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

  return { deleted: 0, inserted, skipped, updated };
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

  const calendarRows = await db.select({
    date: workCalendar.date,
    isHoliday: workCalendar.isHoliday,
    isRemoved: workCalendar.isRemoved,
  })
    .from(workCalendar)
    .where(and(gte(workCalendar.date, startDate), lte(workCalendar.date, endDate)));
  const calendarByDate = new Map(calendarRows.map((row) => [normalizeDateKey(row.date), row]));

  const workingDates = candidateDates.filter((date) => {
    if (isSuppressedGhanaHolidayDate(date)) return true;
    const calendarDay = calendarByDate.get(date);
    if (calendarDay) return !(calendarDay.isHoliday && !calendarDay.isRemoved);
    return !getObservedGhanaHolidayForDate(date);
  });

  if (workingDates.length === 0) {
    return { deleted: 0, inserted: 0, skipped: 0, updated: 0 };
  }

  const staffRows = await db.select({
    id: staff.id,
    isAttendanceOnly: staff.isAttendanceOnly,
    isNssPersonnel: staff.isNssPersonnel,
  })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)));

  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
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
      eq(attendancePermission.status, 'approved'),
    ));
  const permissionsByKey = new Map(
    permissionRows.map((row) => [rowKey(row.staffId, normalizeDateKey(row.date)), row]),
  );

  const existingRows = await db.select()
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, startDate), lte(latenessEntry.date, endDate)));
  const existingByKey = new Map(
    existingRows.map((row) => [rowKey(row.staffId, normalizeDateKey(row.date)), row]),
  );

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const date of workingDates) {
    for (const member of staffRows) {
      if (member.isAttendanceOnly === true) {
        skipped += 1;
        continue;
      }

      const key = rowKey(member.id, date);
      const attendance = attendanceByKey.get(key);
      if (attendance?.noShowSignInWaived === true || attendance?.source === 'no_show_sign_in_waiver') {
        skipped += 1;
        continue;
      }
      if (attendance && normalizeTimeKey(attendance.checkInTime)) {
        skipped += 1;
        continue;
      }

      const permission = permissionsByKey.get(key);
      if (permission?.permissionType === 'absence') {
        skipped += 1;
        continue;
      }

      const penalty = resolveManualPenalty({
        activePermission: permission || null,
        arrivalTime: null,
        didNotSignOut: false,
        isAttendanceOnly: false,
        isNssPersonnel: member.isNssPersonnel === true,
        noSignIn: true,
      });
      if (penalty.amount <= 0) {
        skipped += 1;
        continue;
      }

      const existing = existingByKey.get(key);
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

        await db.update(latenessEntry)
          .set({
            arrivalTime: null,
            computedAmount,
            didNotSignOut: false,
            reason: NO_SHOW_SIGN_IN_REASON,
            updatedAt: new Date(),
          })
          .where(eq(latenessEntry.id, existing.id));
        updated += 1;
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

  return { deleted: 0, inserted, skipped, updated };
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
      eq(attendancePermission.status, 'approved'),
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
  let updated = 0;

  for (const row of attendanceRows) {
    const date = normalizeDateKey(row.date);
    const arrivalTime = normalizeTimeKey(row.checkInTime);
    if (!date || !row.staffId) continue;

    const key = rowKey(row.staffId, date);
    const existingEntriesForKey = existingByStaffDate.get(key) || [];
    const existing = existingEntriesForKey[0] || null;
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
    const penalty = resolveManualPenalty({
      activePermission,
      arrivalTime,
      didNotSignOut,
      isAttendanceOnly: row.isAttendanceOnly === true,
      isNssPersonnel: row.isNssPersonnel === true,
    });
    const computedAmount = amountText(penalty.amount);
    const attendanceReason = penalty.reason || null;
    const reason = penalty.reason || row.reason || 'Late arrival';

    processedKeys.add(key);

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
        await db.delete(latenessEntry).where(eq(latenessEntry.id, staleEntry.id));
        deleted += 1;
      }
      continue;
    }

    if (existing) {
      for (const duplicateEntry of existingEntriesForKey.slice(1)) {
        await db.delete(latenessEntry).where(eq(latenessEntry.id, duplicateEntry.id));
        deleted += 1;
      }
      const existingAmount = amountText(amountNumber(existing.computedAmount));
      const needsUpdate =
        normalizeTimeKey(existing.arrivalTime) !== arrivalTime ||
        existingAmount !== computedAmount ||
        (existing.reason || '') !== reason ||
        existing.didNotSignOut !== penalty.didNotSignOut;

      if (!needsUpdate) continue;

      await db.update(latenessEntry)
        .set({
          arrivalTime,
          computedAmount,
          didNotSignOut: penalty.didNotSignOut,
          reason,
          updatedAt: new Date(),
        })
        .where(eq(latenessEntry.id, existing.id));
      updated += 1;
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

  for (const existing of existingRows) {
    const date = normalizeDateKey(existing.date);
    const key = rowKey(existing.staffId, date);
    if (processedKeys.has(key)) continue;
    if (existing.reason === NO_SHOW_SIGN_IN_REASON || existing.reason === NO_SHOW_SIGN_IN_WAIVED_REASON) continue;

    const activePermission = permissionsByStaffDate.get(key) || null;
    if (!activePermission) continue;

    const penalty = resolveManualPenalty({
      activePermission,
      arrivalTime: normalizeTimeKey(existing.arrivalTime),
      didNotSignOut: existing.didNotSignOut === true,
    });
    const computedAmount = amountText(penalty.amount);

    if (penalty.amount <= 0) {
      await db.delete(latenessEntry).where(eq(latenessEntry.id, existing.id));
      deleted += 1;
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

    await db.update(latenessEntry)
      .set({
        computedAmount,
        didNotSignOut: penalty.didNotSignOut,
        reason: penalty.reason || existing.reason || 'Late arrival',
        updatedAt: new Date(),
      })
      .where(eq(latenessEntry.id, existing.id));
    updated += 1;
  }

  const noShowSignInResult = await applyNoShowSignInPenaltiesForRange(startDate, endDate);
  deleted += noShowSignInResult.deleted;
  inserted += noShowSignInResult.inserted;
  updated += noShowSignInResult.updated;

  return { attendanceUpdated, deleted, inserted, updated };
}
