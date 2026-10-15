// The Payments page shows one month at a time (the month picked under Offence book inputs): each
// person's penalty days in that month, what was paid and pardoned for them, and what is still owed.

type MonthEntryLike = {
  date: string;
  outstandingAmount: string;
  paidAmount: string;
  penaltyAmount: string;
};

type MonthPaymentLike = {
  // The months whose penalty days the payment paid.
  months?: string[];
  recordedAt: string | null;
};

type MonthRowLike = {
  entries: MonthEntryLike[];
  outstandingBalance: string;
  paidAmount: string;
  payments?: MonthPaymentLike[];
  totalPenalty: string;
};

function pesewas(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

// Adds amounts in pesewas, so the totals carry no floating-point dust.
export function sumMoney(values: Array<string | number | null | undefined>) {
  return (values.reduce<number>((total, value) => total + pesewas(value), 0) / 100).toFixed(2);
}

// A payment belongs to the months it paid; one with nothing allocated belongs to the month it was
// recorded in.
export function paymentMonths(payment: MonthPaymentLike) {
  if (payment.months && payment.months.length > 0) return payment.months;
  return payment.recordedAt ? [payment.recordedAt.slice(0, 7)] : [];
}

// One person in one month (2026-10). allMonthsBalance keeps what they owe across every month.
export function rowForMonth<Row extends MonthRowLike>(row: Row, monthKey: string): Row & { allMonthsBalance: string } {
  const entries = row.entries.filter((entry) => entry.date.slice(0, 7) === monthKey) as Row['entries'];
  return {
    ...row,
    allMonthsBalance: row.outstandingBalance,
    entries,
    outstandingBalance: sumMoney(entries.map((entry) => entry.outstandingAmount)),
    paidAmount: sumMoney(entries.map((entry) => entry.paidAmount)),
    payments: row.payments?.filter((payment) => paymentMonths(payment).includes(monthKey)) as Row['payments'],
    totalPenalty: sumMoney(entries.map((entry) => entry.penaltyAmount)),
  };
}

// A pardon started from a month covers debts up to the end of that month, never past yesterday.
export function pardonCutoffForMonth(monthKey: string, yesterday: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return monthEnd < yesterday ? monthEnd : yesterday;
}
