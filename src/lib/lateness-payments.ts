import type { LatenessPaymentReceiptSummary } from '@/lib/lateness-payment-receipts';

export type LatenessPaymentStatus = 'paid' | 'partially_paid' | 'unpaid' | 'pardoned' | 'partially_pardoned';

export type LatenessPaymentEntryLike = {
  arrivalTime?: string | null;
  computedAmount: number | string | null;
  date: string;
  id: string;
  pardonedAmount?: number | string | null;
  reason?: string | null;
  staffId?: string | null;
};

export type LatenessPaymentAllocationLike = {
  allocatedAmount?: number | string | null;
  amount?: number | string | null;
  entryId: string;
};

export type MonthlyLatenessPaymentEntryLike = {
  computedAmount: number | string | null;
  date: string;
  id: string;
  pardonedAmount?: number | string | null;
  pardonedAt?: string | Date | null;
};

export type DatedLatenessPaymentAllocationLike = LatenessPaymentAllocationLike & {
  recordedAt?: string | Date | null;
};

export type MonthlyLatenessPaymentBalance = {
  month: string;
  paidAmount: string;
  pardonedAmount: string;
  penaltyAmount: string;
  unpaidAmount: string;
};

export type LatenessPaymentEntrySummary = {
  arrivalTime: string | null;
  date: string;
  entryId: string;
  outstandingAmount: string;
  pardonedAmount: string;
  paidAmount: string;
  penaltyAmount: string;
  reason: string | null;
  status: LatenessPaymentStatus;
};

export type LatenessPaymentWeekSummary = {
  endDate: string;
  entries: LatenessPaymentEntrySummary[];
  outstandingBalance: string;
  paidAmount: string;
  receipts: LatenessPaymentReceiptSummary[];
  startDate: string;
  status: LatenessPaymentStatus;
  totalPenalty: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cents(value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

function money(valueInCents: number) {
  return (Math.max(0, valueInCents) / 100).toFixed(2);
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthEndTimestamp(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return Date.UTC(year, monthNumber, 0, 23, 59, 59, 999);
}

function timestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthRange(startMonth: string, endMonth: string) {
  const [startYear, startMonthNumber] = startMonth.split('-').map(Number);
  const [endYear, endMonthNumber] = endMonth.split('-').map(Number);
  const months: string[] = [];

  for (let cursor = new Date(Date.UTC(startYear, startMonthNumber - 1, 1));
    cursor <= new Date(Date.UTC(endYear, endMonthNumber - 1, 1));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    months.push(cursor.toISOString().slice(0, 7));
  }

  return months;
}

export function summarizeLatenessPaymentsByMonth(input: {
  allocations: DatedLatenessPaymentAllocationLike[];
  currentDate: string;
  entries: MonthlyLatenessPaymentEntryLike[];
}): MonthlyLatenessPaymentBalance[] {
  const entriesByMonth = new Map<string, MonthlyLatenessPaymentEntryLike[]>();
  const allocationsByEntryId = new Map<string, DatedLatenessPaymentAllocationLike[]>();

  for (const entry of input.entries) {
    if (cents(entry.computedAmount) <= 0) continue;
    const month = entry.date.slice(0, 7);
    const rows = entriesByMonth.get(month) || [];
    rows.push(entry);
    entriesByMonth.set(month, rows);
  }

  for (const allocation of input.allocations) {
    const rows = allocationsByEntryId.get(allocation.entryId) || [];
    rows.push(allocation);
    allocationsByEntryId.set(allocation.entryId, rows);
  }

  const populatedMonths = [...entriesByMonth.keys()].sort();
  if (populatedMonths.length === 0) return [];

  const throughMonth = input.currentDate.slice(0, 7);
  return monthRange(populatedMonths[0], throughMonth).map((month) => {
    const asOf = monthEndTimestamp(month);
    let penaltyCents = 0;
    let paidCents = 0;
    let pardonedCents = 0;

    for (const entry of entriesByMonth.get(month) || []) {
      const entryPenaltyCents = cents(entry.computedAmount);
      penaltyCents += entryPenaltyCents;

      const entryPaidCents = (allocationsByEntryId.get(entry.id) || [])
        .reduce((sum, allocation) => {
          const recordedAt = timestamp(allocation.recordedAt);
          return recordedAt !== null && recordedAt <= asOf
            ? sum + cents(allocation.allocatedAmount ?? allocation.amount)
            : sum;
        }, 0);
      const paidForEntryCents = Math.min(entryPenaltyCents, entryPaidCents);
      paidCents += paidForEntryCents;

      const pardonedAt = timestamp(entry.pardonedAt);
      if (pardonedAt !== null && pardonedAt <= asOf) {
        pardonedCents += Math.min(
          Math.max(0, entryPenaltyCents - paidForEntryCents),
          cents(entry.pardonedAmount),
        );
      }
    }

    const unpaidCents = Math.max(0, penaltyCents - paidCents - pardonedCents);
    return {
      month,
      paidAmount: money(paidCents),
      pardonedAmount: money(pardonedCents),
      penaltyAmount: money(penaltyCents),
      unpaidAmount: money(unpaidCents),
    };
  });
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function getWeekBoundsForDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = addDays(date, mondayOffset);
  const end = addDays(start, 4);

  return {
    weekEnd: formatDateKey(end),
    weekStart: formatDateKey(start),
  };
}

export function getLatenessPaymentStatus(total: number | string | null | undefined, paid: number | string | null | undefined): LatenessPaymentStatus {
  const totalCents = cents(total);
  const paidCents = cents(paid);

  if (totalCents <= 0 || paidCents >= totalCents) return 'paid';
  if (paidCents > 0) return 'partially_paid';
  return 'unpaid';
}

function paidCentsByEntry(allocations: LatenessPaymentAllocationLike[]) {
  const totals = new Map<string, number>();

  for (const allocation of allocations) {
    const value = cents(allocation.allocatedAmount ?? allocation.amount);
    if (value <= 0) continue;
    totals.set(allocation.entryId, (totals.get(allocation.entryId) || 0) + value);
  }

  return totals;
}

function sortedPenaltyEntries(entries: LatenessPaymentEntryLike[]) {
  return entries
    .filter((entry) => cents(entry.computedAmount) > 0)
    .slice()
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      return dateCompare !== 0 ? dateCompare : a.id.localeCompare(b.id);
    });
}

export function summarizeLatenessPaymentEntries(input: {
  allocations: LatenessPaymentAllocationLike[];
  entries: LatenessPaymentEntryLike[];
}): LatenessPaymentEntrySummary[] {
  const paidByEntry = paidCentsByEntry(input.allocations);

  return sortedPenaltyEntries(input.entries).map((entry) => {
    const penaltyCents = cents(entry.computedAmount);
    const paidCents = Math.min(penaltyCents, paidByEntry.get(entry.id) || 0);
    const pardonedCents = Math.min(Math.max(0, penaltyCents - paidCents), cents(entry.pardonedAmount));
    const outstandingCents = Math.max(0, penaltyCents - paidCents - pardonedCents);

    return {
      arrivalTime: entry.arrivalTime || null,
      date: entry.date,
      entryId: entry.id,
      outstandingAmount: money(outstandingCents),
      pardonedAmount: money(pardonedCents),
      paidAmount: money(paidCents),
      penaltyAmount: money(penaltyCents),
      reason: entry.reason || null,
      status: outstandingCents === 0 && pardonedCents > 0
        ? 'pardoned'
        : pardonedCents > 0 && paidCents === 0
          ? 'partially_pardoned'
          : getLatenessPaymentStatus(penaltyCents / 100, paidCents / 100),
    };
  });
}

export function allocateLatenessPayment(input: {
  amount: number | string;
  entries: LatenessPaymentEntryLike[];
  existingAllocations: LatenessPaymentAllocationLike[];
  entryId?: string | null;
}) {
  const amountCents = cents(input.amount);
  if (amountCents <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  const entries = sortedPenaltyEntries(input.entries);
  const paidByEntry = paidCentsByEntry(input.existingAllocations);
  const candidates = input.entryId
    ? entries.filter((entry) => entry.id === input.entryId)
    : entries;

  if (input.entryId && candidates.length === 0) {
    throw new Error('Lateness entry was not found');
  }

  const outstandingItems = candidates
    .map((entry) => {
      const penaltyCents = cents(entry.computedAmount);
      const paidCents = Math.min(penaltyCents, paidByEntry.get(entry.id) || 0);
      const pardonedCents = Math.min(Math.max(0, penaltyCents - paidCents), cents(entry.pardonedAmount));
      return {
        entry,
        outstandingCents: Math.max(0, penaltyCents - paidCents - pardonedCents),
      };
    })
    .filter((item) => item.outstandingCents > 0);

  const outstandingBeforeCents = outstandingItems.reduce((sum, item) => sum + item.outstandingCents, 0);

  if (amountCents > outstandingBeforeCents) {
    throw new Error('Payment amount exceeds outstanding balance');
  }

  let remainingCents = amountCents;
  const allocations: Array<{ amount: string; entryId: string }> = [];

  for (const item of outstandingItems) {
    if (remainingCents <= 0) break;

    const allocatedCents = Math.min(remainingCents, item.outstandingCents);
    allocations.push({
      amount: money(allocatedCents),
      entryId: item.entry.id,
    });
    remainingCents -= allocatedCents;
  }

  return {
    allocations,
    outstandingAfter: money(outstandingBeforeCents - amountCents),
    outstandingBefore: money(outstandingBeforeCents),
  };
}

export function summarizePenaltyHistoryWeeks(input: {
  currentDate: string;
  entries: LatenessPaymentEntrySummary[];
  receipts?: LatenessPaymentReceiptSummary[];
}): {
  currentWeek: LatenessPaymentWeekSummary;
  weeks: LatenessPaymentWeekSummary[];
} {
  const currentBounds = getWeekBoundsForDate(input.currentDate);
  const groups = new Map<string, LatenessPaymentEntrySummary[]>();
  const receiptGroups = new Map<string, LatenessPaymentReceiptSummary[]>();
  const receipts = input.receipts || [];

  for (const entry of input.entries) {
    const bounds = getWeekBoundsForDate(entry.date);
    const key = `${bounds.weekStart}:${bounds.weekEnd}`;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  for (const receipt of receipts) {
    const key = `${receipt.weekStart}:${receipt.weekEnd}`;
    const list = receiptGroups.get(key) || [];
    list.push(receipt);
    receiptGroups.set(key, list);
  }

  const makeWeek = (weekStart: string, weekEnd: string): LatenessPaymentWeekSummary => {
    const key = `${weekStart}:${weekEnd}`;
    const entries = groups.get(key) || [];
    const weekReceipts = (receiptGroups.get(key) || []).slice().sort((left, right) => (
      (right.recordedAt || '').localeCompare(left.recordedAt || '')
    ));
    const totalPenaltyCents = entries.reduce((sum, entry) => sum + cents(entry.penaltyAmount), 0);
    const paidCents = entries.reduce((sum, entry) => sum + cents(entry.paidAmount), 0);
    const pardonedCents = entries.reduce((sum, entry) => sum + cents(entry.pardonedAmount), 0);
    const outstandingCents = entries.reduce((sum, entry) => sum + cents(entry.outstandingAmount), 0);

    return {
      endDate: weekEnd,
      entries,
      outstandingBalance: money(outstandingCents),
      paidAmount: money(paidCents),
      receipts: weekReceipts,
      startDate: weekStart,
      status: outstandingCents === 0
        ? pardonedCents > 0 ? 'pardoned' : 'paid'
        : paidCents > 0 ? 'partially_paid' : pardonedCents > 0 ? 'partially_pardoned' : 'unpaid',
      totalPenalty: money(totalPenaltyCents),
    };
  };

  const weekKeys = new Set([
    ...groups.keys(),
    ...receiptGroups.keys(),
  ]);

  const weeks = Array.from(weekKeys)
    .map((key) => {
      const [weekStart, weekEnd] = key.split(':');
      return makeWeek(weekStart, weekEnd);
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const currentKey = `${currentBounds.weekStart}:${currentBounds.weekEnd}`;
  const currentWeek = weeks.find((week) => `${week.startDate}:${week.endDate}` === currentKey)
    || makeWeek(currentBounds.weekStart, currentBounds.weekEnd);

  return { currentWeek, weeks };
}
