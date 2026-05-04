import 'server-only';

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceRecord, latenessEntry, staff } from '@/db/schema';
import { computePenalty } from '@/lib/penalty-calculator';

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

export async function syncLatenessEntriesFromAttendanceForDate(dateKey: string) {
  return syncLatenessEntriesFromAttendanceForRange(dateKey, dateKey);
}

export async function syncLatenessEntriesFromAttendanceForRange(startDate: string, endDate: string) {
  const attendanceRows = await db.select({
    checkInTime: attendanceRecord.checkInTime,
    computedAmount: attendanceRecord.computedAmount,
    date: attendanceRecord.date,
    reason: attendanceRecord.reason,
    staffId: attendanceRecord.staffId,
    staffName: staff.fullName,
    status: attendanceRecord.status,
  })
    .from(attendanceRecord)
    .leftJoin(staff, eq(staff.id, attendanceRecord.staffId))
    .where(and(gte(attendanceRecord.date, startDate), lte(attendanceRecord.date, endDate)));

  const candidates = attendanceRows
    .map((row) => {
      const date = normalizeDateKey(row.date);
      const arrivalTime = normalizeTimeKey(row.checkInTime);
      const amount = amountNumber(row.computedAmount);
      const penalty = computePenalty({
        arrivalTime,
        didNotSignOut: false,
        isHoliday: false,
      });
      const isLate = row.status === 'late' || amount > 0 || penalty.amount > 0;

      return {
        amount: amount > 0 ? amount : penalty.amount,
        arrivalTime,
        date,
        reason: row.reason || penalty.reason || 'Late arrival',
        staffId: row.staffId,
        shouldSync: isLate,
      };
    })
    .filter((row) => row.shouldSync && row.date && row.staffId);

  if (candidates.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const existingRows = await db.select()
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, startDate), lte(latenessEntry.date, endDate)));
  const existingByStaffDate = new Map(
    existingRows.map((entry) => [`${entry.staffId}:${normalizeDateKey(entry.date)}`, entry]),
  );

  let inserted = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const key = `${candidate.staffId}:${candidate.date}`;
    const existing = existingByStaffDate.get(key);
    const existingDidNotSignOut = existing?.didNotSignOut === true;
    const nextPenalty = existingDidNotSignOut
      ? computePenalty({
          arrivalTime: candidate.arrivalTime,
          didNotSignOut: true,
          isHoliday: false,
        })
      : null;
    const computedAmount = amountText(nextPenalty?.amount || candidate.amount);
    const reason = nextPenalty?.reason || candidate.reason;

    if (existing) {
      const existingAmount = amountText(amountNumber(existing.computedAmount));
      const needsUpdate =
        normalizeTimeKey(existing.arrivalTime) !== candidate.arrivalTime ||
        existingAmount !== computedAmount ||
        (existing.reason || '') !== reason;

      if (!needsUpdate) continue;

      await db.update(latenessEntry)
        .set({
          arrivalTime: candidate.arrivalTime,
          computedAmount,
          didNotSignOut: existingDidNotSignOut,
          reason,
          updatedAt: new Date(),
        })
        .where(eq(latenessEntry.id, existing.id));
      updated += 1;
      continue;
    }

    await db.insert(latenessEntry)
      .values({
        arrivalTime: candidate.arrivalTime,
        computedAmount,
        date: candidate.date,
        didNotSignOut: false,
        reason,
        staffId: candidate.staffId,
      })
      .onConflictDoNothing();
    inserted += 1;
  }

  return { inserted, updated };
}
