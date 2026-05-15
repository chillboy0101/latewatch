/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  allocateLatenessPayment,
  getLatenessPaymentStatus,
  summarizeLatenessPaymentEntries,
} = require('../src/lib/lateness-payments.ts');

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
