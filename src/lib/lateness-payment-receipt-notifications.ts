import { getLatenessPaymentReceiptNumber } from '@/lib/lateness-payment-receipts';

export const RECEIPT_NOTIFICATION_AUTO_DISMISS_MS = 8_000;

export type LatenessPaymentReceiptNotificationPaymentLike = {
  amount: number | string | null;
  id: string;
  recordedAt?: Date | string | null;
  recordedByEmail?: string | null;
  weekEnd: string;
  weekStart: string;
};

export type LatenessPaymentReceiptNotification = {
  amount: string;
  href: string;
  id: string;
  paymentId: string;
  read: boolean;
  receiptNumber: string;
  recordedAt: string | null;
  recordedByEmail: string | null;
  weekEnd: string;
  weekStart: string;
};

function money(value: number | string | null | undefined) {
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function isoDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getLatenessPaymentReceiptNotificationId(paymentId: string) {
  return `receipt:${paymentId}`;
}

export function getLatenessPaymentReceiptNotificationHref(paymentId: string) {
  return `/check-in/receipts/${paymentId}`;
}

export function buildLatenessPaymentReceiptNotification(
  payment: LatenessPaymentReceiptNotificationPaymentLike,
): LatenessPaymentReceiptNotification {
  return {
    amount: money(payment.amount),
    href: getLatenessPaymentReceiptNotificationHref(payment.id),
    id: getLatenessPaymentReceiptNotificationId(payment.id),
    paymentId: payment.id,
    read: false,
    receiptNumber: getLatenessPaymentReceiptNumber(payment.id, payment.recordedAt),
    recordedAt: isoDateTime(payment.recordedAt),
    recordedByEmail: payment.recordedByEmail || null,
    weekEnd: payment.weekEnd,
    weekStart: payment.weekStart,
  };
}

export function buildLatenessPaymentReceiptNotifications(
  payments: LatenessPaymentReceiptNotificationPaymentLike[],
) {
  return payments.map(buildLatenessPaymentReceiptNotification);
}

export function buildLatenessPaymentReceiptPushPayload(
  payment: LatenessPaymentReceiptNotificationPaymentLike,
) {
  const href = getLatenessPaymentReceiptNotificationHref(payment.id);

  return {
    body: `GHC ${money(payment.amount)} was recorded. Tap to view your receipt.`,
    data: {
      paymentId: payment.id,
      url: href,
    },
    icon: '/latewatch-logo.png',
    renotify: false,
    requireInteraction: false,
    tag: `latewatch-receipt-${payment.id}`,
    title: 'Payment receipt ready',
  };
}
