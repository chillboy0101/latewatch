import 'server-only';

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry, staff } from '@/db/schema';
import { getAccraClock } from '@/lib/attendance';
import { resolveManualPenalty } from '@/lib/manual-attendance-correction';
import { shouldAlertNoSignOut } from '@/lib/work-hours';

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

export async function syncLatenessEntriesFromAttendanceForDate(dateKey: string) {
  return syncLatenessEntriesFromAttendanceForRange(dateKey, dateKey);
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

  return { attendanceUpdated, deleted, inserted, updated };
}
