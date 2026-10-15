/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { pardonCutoffForMonth, paymentMonths, rowForMonth, sumMoney } = require('../src/lib/payment-months.ts');
const { summarizeLatenessPaymentEntries, summarizeLatenessPaymentsByMonth } = require('../src/lib/lateness-payments.ts');

// Two people charged in September and October: some days paid, one pardoned, the rest owed.
const charges = {
  ama: [
    { computedAmount: '10.10', date: '2026-09-03', id: 'a1' },
    { computedAmount: '20.20', date: '2026-09-17', id: 'a2', pardonedAmount: '20.20' },
    { computedAmount: '30.30', date: '2026-10-02', id: 'a3' },
    { computedAmount: '10.00', date: '2026-10-09', id: 'a4' },
  ],
  kofi: [
    { computedAmount: '5.00', date: '2026-10-05', id: 'k1' },
  ],
};
const allocations = [
  { allocatedAmount: '10.10', entryId: 'a1', paymentId: 'p1' },
  { allocatedAmount: '15.00', entryId: 'a3', paymentId: 'p2' },
  { allocatedAmount: '5.00', entryId: 'k1', paymentId: 'p3' },
];

function staffRow(id, entries, payments) {
  const summaries = summarizeLatenessPaymentEntries({
    allocations: allocations.filter((allocation) => entries.some((entry) => entry.id === allocation.entryId)),
    entries,
  });
  return {
    entries: summaries,
    id,
    outstandingBalance: sumMoney(summaries.map((entry) => entry.outstandingAmount)),
    paidAmount: sumMoney(summaries.map((entry) => entry.paidAmount)),
    payments,
    totalPenalty: sumMoney(summaries.map((entry) => entry.penaltyAmount)),
  };
}

const ama = staffRow('ama', charges.ama, [
  { amount: '15.00', id: 'p2', months: ['2026-10'], recordedAt: '2026-10-10T09:00:00.000Z' },
  { amount: '10.10', id: 'p1', months: ['2026-09'], recordedAt: '2026-10-01T09:00:00.000Z' },
  { amount: '3.00', id: 'old', months: [], recordedAt: '2026-09-30T23:59:00.000Z' },
]);
const kofi = staffRow('kofi', charges.kofi, [
  { amount: '5.00', id: 'p3', months: ['2026-10'], recordedAt: '2026-10-06T09:00:00.000Z' },
]);

test('a staff row shows only the chosen month, and keeps what is owed across all months', () => {
  const october = rowForMonth(ama, '2026-10');
  assert.deepEqual(october.entries.map((entry) => entry.entryId), ['a3', 'a4']);
  assert.equal(october.totalPenalty, '40.30');
  assert.equal(october.paidAmount, '15.00');
  assert.equal(october.outstandingBalance, '25.30');
  assert.equal(october.allMonthsBalance, '25.30');
  // Payments are listed under the month whose days they paid, not the month they were recorded.
  assert.deepEqual(october.payments.map((payment) => payment.id), ['p2']);

  const september = rowForMonth(ama, '2026-09');
  assert.equal(september.totalPenalty, '30.30');
  assert.equal(september.paidAmount, '10.10');
  assert.equal(september.outstandingBalance, '0.00');
  assert.deepEqual(september.payments.map((payment) => payment.id), ['p1', 'old']);

  const august = rowForMonth(ama, '2026-08');
  assert.deepEqual(august.entries, []);
  assert.equal(august.totalPenalty, '0.00');
  assert.equal(august.outstandingBalance, '0.00');
});

test('the month rows add up to the month totals shown above the table', () => {
  const breakdown = summarizeLatenessPaymentsByMonth({
    allocations,
    currentDate: '2026-10-15',
    entries: [...charges.ama, ...charges.kofi],
  });
  for (const total of breakdown) {
    const rows = [ama, kofi].map((row) => rowForMonth(row, total.month));
    const pardoned = rows.flatMap((row) => row.entries.map((entry) => entry.pardonedAmount));
    assert.equal(sumMoney(rows.map((row) => row.totalPenalty)), total.penaltyAmount, total.month);
    assert.equal(sumMoney(rows.map((row) => row.paidAmount)), total.paidAmount, total.month);
    assert.equal(sumMoney(pardoned), total.pardonedAmount, total.month);
    assert.equal(sumMoney(rows.map((row) => row.outstandingBalance)), total.unpaidAmount, total.month);
  }
});

test('money adds up in pesewas and payment months fall back to the recorded month', () => {
  assert.equal(sumMoney(['0.10', '0.20', null, undefined, 'x']), '0.30');
  assert.deepEqual(paymentMonths({ months: ['2026-08', '2026-09'], recordedAt: '2026-10-01T00:00:00.000Z' }), ['2026-08', '2026-09']);
  assert.deepEqual(paymentMonths({ recordedAt: '2026-10-01T00:00:00.000Z' }), ['2026-10']);
  assert.deepEqual(paymentMonths({ recordedAt: null }), []);
});

test('a pardon from a month view covers up to that month end, never past yesterday', () => {
  assert.equal(pardonCutoffForMonth('2026-09', '2026-10-14'), '2026-09-30');
  assert.equal(pardonCutoffForMonth('2028-02', '2028-10-14'), '2028-02-29');
  assert.equal(pardonCutoffForMonth('2026-10', '2026-10-14'), '2026-10-14');
  assert.equal(pardonCutoffForMonth('2026-12', '2026-10-14'), '2026-10-14');
});

test('the Payments table switches between everyone\'s total and the chosen month', () => {
  const page = read('src/app/payments/page.tsx');
  const api = read('src/app/api/payments/lateness/route.ts');
  // Total by default: each person's balance across all months, as before.
  assert.match(page, /const \[tableView, setTableView\] = useState<TableView>\('total'\);/);
  assert.match(page, /\{view === 'total' \? 'Total' : selectedMonthShort\}/);
  assert.match(page, /return \(data\?\.staff \|\| \[\]\)\.map\(\(row\) => \(\{ \.\.\.row, allMonthsBalance: row\.outstandingBalance \}\)\);/);
  assert.match(page, /\(data\?\.staff \|\| \[\]\)\.map\(\(row\) => rowForMonth\(row, selectedMonthKey\)\)/);
  assert.match(page, /const viewRows = monthView \? monthRows : totalRows;/);
  assert.match(page, /return viewRows\.find\(\(row\) => row\.id === selectedStaffId\)/);
  // Picking a month or year up top shows that month.
  assert.equal((page.match(/setTableView\('month'\);/g) || []).length, 2);
  // Both views keep the same table (Staff, Status, Balance, Action); the month view pays within the
  // month and Total pays as before.
  assert.doesNotMatch(page, />Penalties<\/th>/);
  assert.equal((page.match(/colSpan=\{4\}/g) || []).length, 2);
  assert.equal((page.match(/month: monthView \? selectedMonthKey : undefined,/g) || []).length, 2);
  assert.match(page, /note: monthView \? `Marked \$\{selectedMonthName\} paid` : 'Marked balance paid',/);
  assert.match(page, /monthView \? `No penalties in \$\{selectedMonthName\}\.` : 'No penalty days found\.'/);
  assert.match(page, /owed in total/);
  // The totals row follows the switch: every month in Total, the month on the switch otherwise.
  assert.match(page, /unpaidAmount: sumMoney\(rows\.map\(\(row\) => row\.outstandingBalance\)\)/);
  for (const label of ['Penalties', 'Paid', 'Pardoned', 'Unpaid']) {
    assert.match(page, new RegExp(`<PaymentToolbarTotal label="${label}" value=\\{currency\\(shownTotals\\?\\.`), label);
  }
  assert.match(api, /const MONTH_KEY_PATTERN = /);
  assert.match(api, /range: hasDateFilter \? \{ end: weekEnd, start: weekStart \} : month \? monthDateRange\(month\) : null/);
  assert.match(api, /months: \[\.\.\.\(monthsByPaymentId\.get\(payment\.id\) \|\| \[\]\)\]\.sort\(\)/);
  assert.match(api, /paymentId: latenessPaymentAllocation\.paymentId/);
});
