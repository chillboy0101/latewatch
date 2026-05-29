/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  allocateLatenessPayment,
  getLatenessPaymentStatus,
  summarizeLatenessPaymentEntries,
} = require('../src/lib/lateness-payments.ts');
const {
  buildLatenessPaymentReceiptDetail,
  getLatenessPaymentReceiptDocumentTitle,
  getLatenessPaymentReceiptNumber,
  summarizeLatenessPaymentReceipts,
} = require('../src/lib/lateness-payment-receipts.ts');
const {
  buildLatenessPaymentReceiptNotifications,
  buildLatenessPaymentReceiptPushPayload,
  getLatenessPaymentReceiptNotificationId,
} = require('../src/lib/lateness-payment-receipt-notifications.ts');

const entries = [
  { id: 'entry-a', staffId: 'staff-1', date: '2026-05-11', arrivalTime: '08:45', computedAmount: '10.00', reason: 'Late' },
  { id: 'entry-b', staffId: 'staff-1', date: '2026-05-12', arrivalTime: '09:05', computedAmount: '15.00', reason: 'Late' },
  { id: 'entry-c', staffId: 'staff-1', date: '2026-05-13', arrivalTime: '10:10', computedAmount: '20.00', reason: 'Late' },
];

test('weekly partial payments apply to the oldest unpaid late days first', () => {
  const allocation = allocateLatenessPayment({
    amount: 18,
    entries,
    existingAllocations: [],
  });

  assert.deepEqual(allocation.allocations, [
    { amount: '10.00', entryId: 'entry-a' },
    { amount: '8.00', entryId: 'entry-b' },
  ]);
  assert.equal(allocation.outstandingBefore, '45.00');
  assert.equal(allocation.outstandingAfter, '27.00');
});

test('weekly payments skip already paid amounts before allocating the remainder', () => {
  const allocation = allocateLatenessPayment({
    amount: 20,
    entries,
    existingAllocations: [
      { allocatedAmount: '10.00', entryId: 'entry-a' },
      { allocatedAmount: '3.00', entryId: 'entry-b' },
    ],
  });

  assert.deepEqual(allocation.allocations, [
    { amount: '12.00', entryId: 'entry-b' },
    { amount: '8.00', entryId: 'entry-c' },
  ]);
});

test('day payments affect only the selected lateness entry', () => {
  const allocation = allocateLatenessPayment({
    amount: 5,
    entries,
    existingAllocations: [],
    entryId: 'entry-b',
  });

  assert.deepEqual(allocation.allocations, [
    { amount: '5.00', entryId: 'entry-b' },
  ]);
  assert.equal(allocation.outstandingBefore, '15.00');
  assert.equal(allocation.outstandingAfter, '10.00');
});

test('overpayments are rejected', () => {
  assert.throws(
    () => allocateLatenessPayment({
      amount: 46,
      entries,
      existingAllocations: [],
    }),
    /Payment amount exceeds outstanding balance/,
  );
});

test('lateness payment summaries calculate paid status and outstanding balance', () => {
  const summaries = summarizeLatenessPaymentEntries({
    entries,
    allocations: [
      { allocatedAmount: '10.00', entryId: 'entry-a' },
      { allocatedAmount: '7.50', entryId: 'entry-b' },
    ],
  });

  assert.equal(summaries[0].status, 'paid');
  assert.equal(summaries[0].outstandingAmount, '0.00');
  assert.equal(summaries[1].status, 'partially_paid');
  assert.equal(summaries[1].paidAmount, '7.50');
  assert.equal(summaries[1].outstandingAmount, '7.50');
  assert.equal(summaries[2].status, 'unpaid');
  assert.equal(getLatenessPaymentStatus(15, 15), 'paid');
  assert.equal(getLatenessPaymentStatus(15, 3), 'partially_paid');
  assert.equal(getLatenessPaymentStatus(15, 0), 'unpaid');
});

test('lateness payment receipt numbers are stable and date-based', () => {
  assert.equal(
    getLatenessPaymentReceiptNumber('123e4567-e89b-12d3-a456-426614174000', '2026-05-29T10:20:00.000Z'),
    'LW-RCPT-202605-123E4567',
  );
  assert.equal(
    getLatenessPaymentReceiptNumber('123e4567-e89b-12d3-a456-426614174000', new Date('2026-05-29T10:20:00.000Z')),
    'LW-RCPT-202605-123E4567',
  );
});

test('lateness payment receipt print titles include the receipt date and number', () => {
  assert.equal(
    getLatenessPaymentReceiptDocumentTitle('LW-RCPT-202605-123E4567', '2026-05-29T10:20:00.000Z'),
    'LateWatch Receipt 2026-05-29 LW-RCPT-202605-123E4567',
  );
  assert.equal(
    getLatenessPaymentReceiptDocumentTitle('LW-RCPT-UNKNOWN-123E4567', null),
    'LateWatch Receipt unknown-date LW-RCPT-UNKNOWN-123E4567',
  );
});

test('lateness payment receipts summarize every payment without a new receipt table', () => {
  const receipts = summarizeLatenessPaymentReceipts([
    {
      amount: '18.00',
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      note: 'Part payment',
      recordedAt: '2026-05-29T10:20:00.000Z',
      recordedByEmail: 'admin@example.com',
      weekEnd: '2026-05-29',
      weekStart: '2026-05-25',
    },
    {
      amount: '10.00',
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      note: null,
      recordedAt: '2026-05-30T11:00:00.000Z',
      recordedByEmail: 'admin@example.com',
      weekEnd: '2026-05-29',
      weekStart: '2026-05-25',
    },
  ]);

  assert.deepEqual(receipts.map((receipt) => receipt.receiptNumber), [
    'LW-RCPT-202605-AAAAAAAA',
    'LW-RCPT-202605-BBBBBBBB',
  ]);
  assert.equal(receipts[0].paymentId, 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(receipts[0].amount, '18.00');
  assert.equal(receipts[0].note, 'Part payment');
});

test('lateness receipt notifications are one per payment with stable receipt links', () => {
  const payments = [
    {
      amount: '18.00',
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      recordedAt: '2026-05-29T10:20:00.000Z',
      recordedByEmail: 'admin@example.com',
      weekEnd: '2026-05-29',
      weekStart: '2026-05-25',
    },
    {
      amount: '10.00',
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      recordedAt: '2026-05-29T10:30:00.000Z',
      recordedByEmail: 'admin@example.com',
      weekEnd: '2026-05-29',
      weekStart: '2026-05-25',
    },
  ];
  const notifications = buildLatenessPaymentReceiptNotifications(payments);

  assert.deepEqual(notifications.map((notification) => notification.id), [
    'receipt:aaaaaaaa-1111-4111-8111-111111111111',
    'receipt:bbbbbbbb-2222-4222-8222-222222222222',
  ]);
  assert.equal(getLatenessPaymentReceiptNotificationId(payments[0].id), notifications[0].id);
  assert.equal(notifications[0].href, '/check-in/receipts/aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(notifications[0].receiptNumber, 'LW-RCPT-202605-AAAAAAAA');
});

test('lateness receipt push payload opens the exact receipt without renotify', () => {
  const payload = buildLatenessPaymentReceiptPushPayload({
    amount: '18.00',
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    recordedAt: '2026-05-29T10:20:00.000Z',
    recordedByEmail: 'admin@example.com',
    weekEnd: '2026-05-29',
    weekStart: '2026-05-25',
  });

  assert.equal(payload.title, 'Payment receipt ready');
  assert.equal(payload.body, 'GHC 18.00 was recorded. Tap to view your receipt.');
  assert.equal(payload.data.url, '/check-in/receipts/aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(payload.tag, 'latewatch-receipt-aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(payload.renotify, false);
  assert.equal(payload.requireInteraction, false);
});

test('lateness payment receipt details include allocated penalty days only', () => {
  const detail = buildLatenessPaymentReceiptDetail({
    allocations: [
      { allocatedAmount: '10.00', entryId: 'entry-a' },
      { allocatedAmount: '8.00', entryId: 'entry-b' },
      { allocatedAmount: '99.00', entryId: 'entry-missing' },
    ],
    entries,
    payment: {
      amount: '18.00',
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      note: 'Part payment',
      recordedAt: '2026-05-29T10:20:00.000Z',
      recordedByEmail: 'admin@example.com',
      weekEnd: '2026-05-29',
      weekStart: '2026-05-25',
    },
    staff: {
      email: 'staff@example.com',
      fullName: 'Staff Member',
      id: 'staff-1',
    },
  });

  assert.equal(detail.receipt.receiptNumber, 'LW-RCPT-202605-AAAAAAAA');
  assert.equal(detail.staff.fullName, 'Staff Member');
  assert.deepEqual(detail.allocations.map((allocation) => allocation.entryId), ['entry-a', 'entry-b']);
  assert.equal(detail.allocations[0].penaltyAmount, '10.00');
  assert.equal(detail.allocations[1].allocatedAmount, '8.00');
});
