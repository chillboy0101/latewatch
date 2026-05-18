import 'server-only';

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { attendancePermission, attendanceRecord, latenessEntry, staff } from '@/db/schema';
import { resolveManualPenalty } from '@/lib/manual-attendance-correction';

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

function rowKey(staffId: string, date: string) {
  return `${staffId}:${date}`;
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
  const existingByStaffDate = new Map(
    existingRows.map((entry) => [rowKey(entry.staffId, normalizeDateKey(entry.date)), entry]),
  );

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
    const existing = existingByStaffDate.get(key);
    const activePermission = permissionsByStaffDate.get(key) || null;
    const didNotSignOut = existing?.didNotSignOut === true;
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
    const needsAttendanceUpdate =
      attendanceAmount !== computedAmount ||
      (row.reason || null) !== attendanceReason ||
      (row.status || null) !== penalty.status;

    if (needsAttendanceUpdate) {
      await db.update(attendanceRecord)
        .set({
          computedAmount,
          reason: attendanceReason,
          status: penalty.status,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecord.id, row.id));
      attendanceUpdated += 1;
    }

    if (penalty.amount <= 0) {
      if (existing) {
        await db.delete(latenessEntry).where(eq(latenessEntry.id, existing.id));
        deleted += 1;
      }
      continue;
    }

    if (existing) {
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
