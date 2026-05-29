export type LatenessPaymentReceiptPaymentLike = {
  amount: number | string | null;
  id: string;
  note?: string | null;
  recordedAt?: Date | string | null;
  recordedByEmail?: string | null;
  weekEnd: string;
  weekStart: string;
};

export type LatenessPaymentReceiptAllocationLike = {
  allocatedAmount?: number | string | null;
  amount?: number | string | null;
  entryId: string;
};

export type LatenessPaymentReceiptEntryLike = {
  arrivalTime?: string | null;
  computedAmount: number | string | null;
  date: string;
  id: string;
  reason?: string | null;
};

export type LatenessPaymentReceiptStaffLike = {
  email?: string | null;
  fullName: string;
  id: string;
};

export type LatenessPaymentReceiptSummary = {
  amount: string;
  note: string | null;
  paymentId: string;
  receiptNumber: string;
  recordedAt: string | null;
  recordedByEmail: string | null;
  weekEnd: string;
  weekStart: string;
};

export type LatenessPaymentReceiptDetail = {
  allocations: Array<{
    allocatedAmount: string;
    arrivalTime: string | null;
    date: string;
    entryId: string;
    penaltyAmount: string;
    reason: string | null;
  }>;
  receipt: LatenessPaymentReceiptSummary;
  staff: {
    email: string | null;
    fullName: string;
    id: string;
  };
};

function parseDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function money(value: number | string | null | undefined) {
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function isoDateTime(value: Date | string | null | undefined) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

export function getLatenessPaymentReceiptNumber(paymentId: string, recordedAt: Date | string | null | undefined) {
  const date = parseDate(recordedAt);
  const period = date
    ? `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}`
    : 'UNKNOWN';
  const suffix = paymentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'UNKNOWN';

  return `LW-RCPT-${period}-${suffix}`;
}

export function summarizeLatenessPaymentReceipt(payment: LatenessPaymentReceiptPaymentLike): LatenessPaymentReceiptSummary {
  return {
    amount: money(payment.amount),
    note: payment.note || null,
    paymentId: payment.id,
    receiptNumber: getLatenessPaymentReceiptNumber(payment.id, payment.recordedAt),
    recordedAt: isoDateTime(payment.recordedAt),
    recordedByEmail: payment.recordedByEmail || null,
    weekEnd: payment.weekEnd,
    weekStart: payment.weekStart,
  };
}

export function summarizeLatenessPaymentReceipts(payments: LatenessPaymentReceiptPaymentLike[]) {
  return payments.map(summarizeLatenessPaymentReceipt);
}

export function buildLatenessPaymentReceiptDetail(input: {
  allocations: LatenessPaymentReceiptAllocationLike[];
  entries: LatenessPaymentReceiptEntryLike[];
  payment: LatenessPaymentReceiptPaymentLike;
  staff: LatenessPaymentReceiptStaffLike;
}): LatenessPaymentReceiptDetail {
  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const allocations = input.allocations
    .map((allocation) => {
      const entry = entryById.get(allocation.entryId);
      if (!entry) return null;

      return {
        allocatedAmount: money(allocation.allocatedAmount ?? allocation.amount),
        arrivalTime: entry.arrivalTime || null,
        date: entry.date,
        entryId: entry.id,
        penaltyAmount: money(entry.computedAmount),
        reason: entry.reason || null,
      };
    })
    .filter((allocation): allocation is NonNullable<typeof allocation> => Boolean(allocation))
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      return dateCompare !== 0 ? dateCompare : left.entryId.localeCompare(right.entryId);
    });

  return {
    allocations,
    receipt: summarizeLatenessPaymentReceipt(input.payment),
    staff: {
      email: input.staff.email || null,
      fullName: input.staff.fullName,
      id: input.staff.id,
    },
  };
}
