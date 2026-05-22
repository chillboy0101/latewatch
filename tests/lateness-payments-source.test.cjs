/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'src/db/schema.ts');
const migrationPath = path.join(root, 'drizzle/0019_lateness_payments.sql');
const paymentsApiPath = path.join(root, 'src/app/api/payments/lateness/route.ts');
const penaltyHistoryApiPath = path.join(root, 'src/app/api/attendance/check-in/penalty-history/route.ts');
const dashboardApiPath = path.join(root, 'src/app/api/dashboard/route.ts');
const paymentsPagePath = path.join(root, 'src/app/payments/page.tsx');
const checkInPagePath = path.join(root, 'src/app/check-in/page.tsx');
const sidebarPath = path.join(root, 'src/components/layout/sidebar.tsx');
const appShellPath = path.join(root, 'src/components/layout/app-shell.tsx');
const proxyPath = path.join(root, 'src/proxy.ts');

test('payment tables and migration are defined separately from lateness entries', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(schema, /export const latenessPayment = pgTable\('lateness_payment'/);
  assert.match(schema, /export const latenessPaymentAllocation = pgTable\('lateness_payment_allocation'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lateness_payment/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lateness_payment_allocation/);
  assert.match(migration, /REFERENCES lateness_entry\(id\)/);
});

test('lateness payment API records payments, allocations, audit events, and realtime invalidations', () => {
  assert.equal(fs.existsSync(paymentsApiPath), true);
  const source = fs.readFileSync(paymentsApiPath, 'utf8');

  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /allocateLatenessPayment/);
  assert.match(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /hasDateFilter/);
  assert.match(source, /eq\(staff\.isAttendanceOnly, false\)/);
  assert.match(source, /paymentWeekStart/);
  assert.match(source, /latenessPaymentAllocation/);
  assert.match(source, /entityType: 'lateness_payment'/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /Payment amount exceeds outstanding balance/);
  assert.doesNotMatch(source, /Valid weekStart and weekEnd are required/);
});

test('staff penalty history endpoint is scoped to the signed-in staff member', () => {
  assert.equal(fs.existsSync(penaltyHistoryApiPath), true);
  const source = fs.readFileSync(penaltyHistoryApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /resolveMemberForPenaltyHistory/);
  assert.match(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /eq\(latenessEntry\.staffId, member\.id\)/);
  assert.match(source, /summarizePenaltyHistoryWeeks/);
  assert.doesNotMatch(source, /searchParams\.get\('staffId'\)/);
});

test('dashboard syncs lateness entries before reading weekly totals', () => {
  const source = fs.readFileSync(dashboardApiPath, 'utf8');

  assert.match(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /prevWeekStartStr/);
  assert.match(source, /weekEndStr/);
});

test('admin payments page and navigation expose payment management actions', () => {
  assert.equal(fs.existsSync(paymentsPagePath), true);
  const page = fs.readFileSync(paymentsPagePath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const appShell = fs.readFileSync(appShellPath, 'utf8');
  const proxy = fs.readFileSync(proxyPath, 'utf8');

  assert.match(page, /DashboardLayout title="Payments"/);
  assert.match(page, /Record amount/);
  assert.match(page, /Pay full balance/);
  assert.match(page, /inputMode="decimal"/);
  assert.match(page, /placeholder="Amount paid"/);
  assert.match(page, /Mark as paid/);
  assert.match(page, /Marked day paid/);
  assert.match(page, /Manage/);
  assert.match(page, /DialogContent/);
  assert.match(page, /max-w-xl/);
  assert.match(page, /compactPenaltyLine/);
  assert.match(page, /paymentRosterSections/);
  assert.match(page, /Main Staff/);
  assert.match(page, /NSS Personnel/);
  assert.match(page, /statusFilter/);
  assert.match(page, /staffPaymentStatusForRow/);
  assert.match(page, /sortPaymentRowsByBalance/);
  assert.match(page, /sortPaymentEntriesNewestFirst/);
  assert.match(page, /selectedEntries\.map/);
  assert.match(page, /subscribeRealtimeChannel/);
  assert.match(page, /'payments', 'entries', 'attendance'/);
  assert.match(page, /\/api\/payments\/lateness/);
  assert.doesNotMatch(page, /Record full or partial lateness payments and keep staff balances transparent/);
  assert.doesNotMatch(page, />Roster</);
  assert.doesNotMatch(page, /<h1[^>]*>Penalty Payments<\/h1>/);
  assert.doesNotMatch(page, /Payment balances/);
  assert.doesNotMatch(page, /All penalty records/);
  assert.doesNotMatch(page, /DashboardLayout title="Penalty Payments"/);
  assert.doesNotMatch(page, /xl:grid-cols/);
  assert.doesNotMatch(page, />Owed<\/th>/);
  assert.doesNotMatch(page, />Paid<\/th>/);
  assert.doesNotMatch(page, /Week start/);
  assert.doesNotMatch(page, /weekStart/);
  assert.doesNotMatch(page, /weekEnd/);
  assert.doesNotMatch(page, /max-h-\[88dvh\] max-w-3xl overflow-y-auto/);
  assert.doesNotMatch(page, /max-h-80 overflow-y-auto/);
  assert.doesNotMatch(page, /MiniAmount/);
  assert.doesNotMatch(page, />Mark paid</);
  assert.doesNotMatch(page, />Pay<\/Button>/);
  assert.doesNotMatch(page, /type="number"/);
  assert.doesNotMatch(page, />Pay balance</);
  assert.doesNotMatch(page, />Record payment</);
  assert.doesNotMatch(page, /rounded-full bg-muted\/40 px-2 py-0\.5">\{staffKind\(row\)\}/);
  assert.match(sidebar, /name: 'Payments'/);
  assert.match(sidebar, /href: '\/payments'/);
  assert.doesNotMatch(sidebar, /Penalty Payments/);
  assert.match(appShell, /payments: 'Payments'/);
  assert.doesNotMatch(appShell, /payments: 'Penalty Payments'/);
  assert.match(proxy, /\/payments\(\.\*\)/);
  assert.match(proxy, /\/api\/payments\(\.\*\)/);
});

test('payments list uses binary paid or unpaid status with toolbar money totals', () => {
  const page = fs.readFileSync(paymentsPagePath, 'utf8');

  assert.match(page, /type PaymentStatus = 'paid' \| 'partially_paid' \| 'unpaid'/);
  assert.match(page, /type StaffPaymentStatus = 'paid' \| 'unpaid'/);
  assert.match(page, /function staffPaymentStatusForRow/);
  assert.doesNotMatch(page, /\{ label: 'Partial', value: 'partially_paid' \}/);
  assert.match(page, /StaffPaymentStatusBadge status=\{staffPaymentStatusForRow\(row\)\}/);
  assert.match(page, /PaymentStatusBadge status=\{entry\.status\}/);
  assert.match(page, /const paymentTotals = useMemo/);
  assert.match(page, /paymentTotals\.paidAmount/);
  assert.match(page, /paymentTotals\.unpaidAmount/);
});

test('check-in page exposes an icon-only penalty history modal', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /Penalty History/);
  assert.match(source, /aria-label="Penalty History"/);
  assert.match(source, /\/api\/attendance\/check-in\/penalty-history/);
  assert.match(source, /Current week totals/);
  assert.match(source, /Current week penalty/);
  assert.match(source, /Current week paid/);
  assert.match(source, /Current week balance/);
});
