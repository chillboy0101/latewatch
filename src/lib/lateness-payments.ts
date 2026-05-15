export type LatenessPaymentStatus = 'paid' | 'partially_paid' | 'unpaid';

export type LatenessPaymentEntryLike = {
  arrivalTime?: string | null;
  computedAmount: number | string | null;
  date: string;
  id: string;
  reason?: string | null;
  staffId?: string | null;
};

export type LatenessPaymentAllocationLike = {
  allocatedAmount?: number | string | null;
  amount?: number | string | null;
  entryId: string;
};

export type LatenessPaymentEntrySummary = {
  arrivalTime: string | null;
  date: string;
  entryId: string;
  outstandingAmount: string;
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
    const outstandingCents = Math.max(0, penaltyCents - paidCents);

    return {
      arrivalTime: entry.arrivalTime || null,
      date: entry.date,
      entryId: entry.id,
      outstandingAmount: money(outstandingCents),
      paidAmount: money(paidCents),
      penaltyAmount: money(penaltyCents),
      reason: entry.reason || null,
      status: getLatenessPaymentStatus(penaltyCents / 100, paidCents / 100),
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
      return {
        entry,
        outstandingCents: Math.max(0, penaltyCents - paidCents),
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
}): {
  currentWeek: LatenessPaymentWeekSummary;
  weeks: LatenessPaymentWeekSummary[];
} {
  const currentBounds = getWeekBoundsForDate(input.currentDate);
  const groups = new Map<string, LatenessPaymentEntrySummary[]>();

  for (const entry of input.entries) {
    const bounds = getWeekBoundsForDate(entry.date);
    const key = `${bounds.weekStart}:${bounds.weekEnd}`;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  const makeWeek = (weekStart: string, weekEnd: string, entries: LatenessPaymentEntrySummary[]): LatenessPaymentWeekSummary => {
    const totalPenaltyCents = entries.reduce((sum, entry) => sum + cents(entry.penaltyAmount), 0);
    const paidCents = entries.reduce((sum, entry) => sum + cents(entry.paidAmount), 0);
    const outstandingCents = Math.max(0, totalPenaltyCents - paidCents);

    return {
      endDate: weekEnd,
      entries,
      outstandingBalance: money(outstandingCents),
      paidAmount: money(paidCents),
      startDate: weekStart,
      status: getLatenessPaymentStatus(totalPenaltyCents / 100, paidCents / 100),
      totalPenalty: money(totalPenaltyCents),
    };
  };

  const weeks = Array.from(groups.entries())
    .map(([key, entries]) => {
      const [weekStart, weekEnd] = key.split(':');
      return makeWeek(weekStart, weekEnd, entries);
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const currentKey = `${currentBounds.weekStart}:${currentBounds.weekEnd}`;
  const currentWeek = weeks.find((week) => `${week.startDate}:${week.endDate}` === currentKey)
    || makeWeek(currentBounds.weekStart, currentBounds.weekEnd, []);

  return { currentWeek, weeks };
}
