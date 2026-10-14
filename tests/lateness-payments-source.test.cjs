/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const dbIndexPath = path.join(root, 'src/db/index.ts');
const schemaPath = path.join(root, 'src/db/schema.ts');
const migrationPath = path.join(root, 'drizzle/0019_lateness_payments.sql');
const paymentsApiPath = path.join(root, 'src/app/api/payments/lateness/route.ts');
const paymentRecordLibPath = path.join(root, 'src/lib/lateness-payment-record.ts');
const penaltyHistoryApiPath = path.join(root, 'src/app/api/attendance/check-in/penalty-history/route.ts');
const receiptApiPath = path.join(root, 'src/app/api/attendance/check-in/receipts/[paymentId]/route.ts');
const receiptNotificationApiPath = path.join(root, 'src/app/api/attendance/check-in/receipt-notifications/route.ts');
const dashboardApiPath = path.join(root, 'src/app/api/dashboard/route.ts');
const paymentsPagePath = path.join(root, 'src/app/payments/page.tsx');
const checkInPagePath = path.join(root, 'src/app/check-in/page.tsx');
const receiptPagePath = path.join(root, 'src/app/check-in/receipts/[paymentId]/page.tsx');
const receiptDetailViewPath = path.join(root, 'src/components/receipts/receipt-detail-view.tsx');
const receiptNotificationLibPath = path.join(root, 'src/lib/lateness-payment-receipt-notifications.ts');
const receiptLibPath = path.join(root, 'src/lib/lateness-payment-receipts.ts');
const sidebarPath = path.join(root, 'src/components/layout/sidebar.tsx');
const appShellPath = path.join(root, 'src/components/layout/app-shell.tsx');
const proxyPath = path.join(root, 'src/proxy.ts');

test('database client prefers the configured unpooled Neon endpoint', () => {
  const dbIndex = fs.readFileSync(dbIndexPath, 'utf8');

  assert.match(dbIndex, /process\.env\.DATABASE_URL_UNPOOLED \|\| process\.env\.DATABASE_URL/);
});

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
  assert.match(source, /sendLatenessPaymentReceiptPush/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /publishRealtime\('notifications'/);
  assert.match(source, /Payment amount exceeds outstanding balance/);
  assert.doesNotMatch(source, /Valid weekStart and weekEnd are required/);
});

test('staff penalty history endpoint is scoped to the signed-in staff member', () => {
  assert.equal(fs.existsSync(penaltyHistoryApiPath), true);
  const source = fs.readFileSync(penaltyHistoryApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /resolveMemberForPenaltyHistory/);
  assert.doesNotMatch(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /eq\(latenessEntry\.staffId, member\.id\)/);
  assert.match(source, /latenessPayment/);
  assert.match(source, /summarizeLatenessPaymentReceipts/);
  assert.match(source, /receipts/);
  assert.match(source, /summarizePenaltyHistoryWeeks/);
  assert.doesNotMatch(source, /searchParams\.get\('staffId'\)/);
});

test('staff receipt API returns only signed-in staff payment receipts', () => {
  assert.equal(fs.existsSync(receiptApiPath), true);
  const source = fs.readFileSync(receiptApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /resolveMemberForReceipt/);
  assert.match(source, /eq\(latenessPayment\.id, paymentId\)/);
  assert.match(source, /eq\(latenessPayment\.staffId, member\.id\)/);
  assert.match(source, /return NextResponse\.json\(\{ error: 'Receipt was not found' \}, \{ status: 404 \}\)/);
  assert.match(source, /latenessPaymentAllocation/);
  assert.match(source, /buildLatenessPaymentReceiptDetail/);
  assert.doesNotMatch(source, /searchParams\.get\('staffId'\)/);
});

test('staff receipt notification API returns only unseen signed-in staff payment receipts', () => {
  assert.equal(fs.existsSync(receiptNotificationApiPath), true);
  const source = fs.readFileSync(receiptNotificationApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /resolveMemberForReceiptNotifications/);
  assert.match(source, /eq\(latenessPayment\.staffId, member\.id\)/);
  assert.match(source, /notificationRead/);
  assert.match(source, /DISMISSED_PREFIX/);
  assert.match(source, /getLatenessPaymentReceiptNotificationId/);
  assert.match(source, /buildLatenessPaymentReceiptNotifications/);
  assert.doesNotMatch(source, /searchParams\.get\('staffId'\)/);
});

test('dashboard reads stored lateness entries for weekly totals', () => {
  const source = fs.readFileSync(dashboardApiPath, 'utf8');

  assert.doesNotMatch(source, /syncLatenessEntriesFromAttendanceForRange/);
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
  assert.match(page, /Live outstanding/);
  assert.match(page, /selectedMonthKey/);
  assert.match(page, /selectedMonthBalance\?\.paidAmount/);
  assert.match(page, /selectedMonthBalance\?\.pardonedAmount/);
  assert.match(page, /selectedMonthBalance\?\.unpaidAmount/);
  assert.match(page, /data\?\.monthlyBreakdown\?\.find/);
  assert.match(page, /PaymentToolbarTotal label="Penalties"/);
  assert.match(page, /PaymentToolbarTotal label="Paid"/);
  assert.match(page, /PaymentToolbarTotal label="Pardoned"/);
  assert.match(page, /PaymentToolbarTotal label="Unpaid"/);
  assert.doesNotMatch(page, /\$\{selectedMonthLabel\} (penalties|paid|pardoned|unpaid)/);
  assert.match(page, /offenceBookRequestRef\.current\?\.key === requestKey/);
  assert.match(page, /offenceBookSelectionRef\.current !== requestKey/);
  assert.doesNotMatch(page, /Monthly lateness balances/);
  assert.doesNotMatch(page, /Paid by month-end/);
});

test('check-in page exposes a penalty history sheet from the overflow menu', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  // The icon-only button was replaced by a row in the ⋮ menu drawer, so the trigger is
  // the labelled row plus the handler that opens the sheet.
  assert.match(source, /Penalty history/);
  assert.match(source, /onClick=\{openPenaltyHistory\}/);
  assert.match(source, /\/api\/attendance\/check-in\/penalty-history/);
  // Minimal: one headline (what you owe, or nothing owed) and one row per penalty day.
  assert.match(source, /<p className="text-sm text-muted-foreground">You owe<\/p>/);
  assert.match(source, /Nothing owed/);
  assert.match(source, /function penaltyReasonLabel\(entry: PenaltyHistoryEntry\)/);
  assert.match(source, /if \(reason\.includes\("DIDN'T SIGN IN"\)\) return 'No sign-in';/);
  assert.doesNotMatch(source, /Current week penalty|PenaltyHistoryStat/);
});

test('receipts live in the Payment receipts sheet, not repeated in penalty history', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /interface PenaltyReceiptSummary/);
  assert.doesNotMatch(source, /PenaltyHistoryReceipts/);
  assert.match(source, /<DrawerTitle>Payment receipts<\/DrawerTitle>/);
  assert.match(source, /onClick=\{\(\) => selectReceipt\(notification\)\}/);
  assert.match(source, /formatDisplayDateTime\(notification\.recordedAt\)/);
});

test('check-in page exposes auto-disappearing receipt notifications', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /RECEIPT_NOTIFICATION_AUTO_DISMISS_MS/);
  assert.match(source, /\/api\/attendance\/check-in\/receipt-notifications/);
  assert.match(source, /ReceiptNotificationToast/);
  assert.match(source, /setTimeout/);
  assert.match(source, /dismissReceiptNotification/);
  assert.match(source, /\/api\/notifications/);
  assert.match(source, /router\.push\(notification\.href\)/);
  assert.match(source, /subscribeRealtimeChannel/);
  assert.match(source, /channel: 'staff-penalty-history'/);
});

test('receipt page is print-friendly and uses LateWatch branding', () => {
  assert.equal(fs.existsSync(receiptPagePath), true);
  const source = fs.readFileSync(receiptPagePath, 'utf8');
  // The receipt body moved into a shared component so the check-in drawer and this page
  // render the same thing; the page keeps the print controls and the document title.
  const detailView = fs.readFileSync(receiptDetailViewPath, 'utf8');

  assert.match(detailView, /LateWatchLogo/);
  assert.match(detailView, /Official Receipt/);
  assert.match(detailView, /Day \/ Date/);
  assert.match(detailView, /formatLongDisplayDate\(allocation\.date\)/);
  assert.match(detailView, /getLatenessPaymentReceiptDocumentTitle/);
  assert.match(source, /Print \/ Save PDF/);
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /document\.title = documentTitle/);
  assert.match(detailView, /\/api\/attendance\/check-in\/receipts\/\$\{paymentId\}/);
  assert.match(source, /@media print/);
  assert.match(detailView, /Receipt No/);
});

test('receipt helper derives stable receipts from existing payment data', () => {
  assert.equal(fs.existsSync(receiptLibPath), true);
  const source = fs.readFileSync(receiptLibPath, 'utf8');

  assert.match(source, /export function getLatenessPaymentReceiptNumber/);
  assert.match(source, /export function getLatenessPaymentReceiptDocumentTitle/);
  assert.match(source, /export function summarizeLatenessPaymentReceipts/);
  assert.match(source, /export function buildLatenessPaymentReceiptDetail/);
  assert.doesNotMatch(source, /receipt_table/);
});

test('receipt notification helper uses stable ids and one-time push payloads', () => {
  assert.equal(fs.existsSync(receiptNotificationLibPath), true);
  const source = fs.readFileSync(receiptNotificationLibPath, 'utf8');

  assert.match(source, /export const RECEIPT_NOTIFICATION_AUTO_DISMISS_MS = 8_000/);
  assert.match(source, /export function getLatenessPaymentReceiptNotificationId/);
  assert.match(source, /`receipt:\$\{paymentId\}`/);
  assert.match(source, /export function buildLatenessPaymentReceiptNotifications/);
  assert.match(source, /export function buildLatenessPaymentReceiptPushPayload/);
  assert.match(source, /latewatch-receipt-\$\{payment\.id\}/);
  assert.match(source, /requireInteraction: false/);
  assert.match(source, /renotify: false/);
});

test('the ⋯ menu shows the status of each sheet at a glance', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  assert.match(source, /function penaltyOwed\(history: PenaltyHistoryResponse \| null\)/);
  assert.match(source, /const owedNow = penaltyOwed\(penaltyHistory\);/);
  assert.match(source, /const owed = penaltyOwed\(history\);/);
  assert.match(source, /owedNow > 0 \? `You owe \$\{ghc\(owedNow\)\}` : 'Nothing owed'/);
  assert.match(source, /if \(signIn && signOut\) return 'On · 8:15 AM & 4:30 PM';/);
  assert.match(source, /if \(next\) void fetchPenaltyHistory\(\);/);
});

test('former staff can pay, and a payment is recorded once, atomically', () => {
  const route = fs.readFileSync(paymentsApiPath, 'utf8');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.doesNotMatch(post, /eq\(staff\.active, true\)/);
  assert.doesNotMatch(post, /eq\(staff\.archived, false\)/);
  assert.match(post, /eq\(staff\.isAttendanceOnly, false\)/);
  // A per-staff lock, then a guarded insert that writes nothing if the balances moved.
  const record = fs.readFileSync(paymentRecordLibPath, 'utf8');
  assert.match(post, /const paymentId = await recordPaymentAtomically\(\{/);
  assert.match(record, /SELECT pg_advisory_xact_lock\(hashtext\(\$\{`lateness-payment:\$\{input\.staffId\}`\}\)\)/);
  assert.match(record, /c\.penalty = plan\.expected_penalty AND c\.paid = plan\.expected_paid AND c\.forgiven = plan\.expected_forgiven/);
  assert.match(record, /WHERE unchanged\.ok/);
  assert.match(post, /status: 409/);
  assert.doesNotMatch(post, /for \(const allocation of allocationPlan\.allocations\) \{\n\s+const \[createdAllocation\] = await db\.insert/);
});

test('dashboard week is worked out in Accra time and day rows say what really happened', () => {
  const api = fs.readFileSync(dashboardApiPath, 'utf8');
  const page = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
  assert.match(api, /const today = getAccraDateKey\(\);/);
  assert.match(api, /gt\(latenessEntry\.computedAmount, '0'\)/);
  assert.match(api, /const holidayDates = await getHolidayDatesForRange\(weekStartStr, weekEndStr\);/);
  assert.match(api, /: dateStr > today\s+\? 'upcoming'\s+: dateStr === today \? 'today' : 'clear';/);
  assert.match(page, /stats\?\.weekStart && stats\.weekEnd/);
  assert.doesNotMatch(page, /startOfWeek/);
  assert.match(page, /status === 'clear' \? 'text-success'/);
});

test('offence book counts former staff, and the payments dialog separates pardons', () => {
  const roster = fs.readFileSync(path.join(root, 'src/lib/offence-book-roster.ts'), 'utf8');
  const items = fs.readFileSync(path.join(root, 'src/app/api/payments/offence-book-items/route.ts'), 'utf8');
  const exportRoute = fs.readFileSync(path.join(root, 'src/app/api/export/offence-book/route.ts'), 'utf8');
  const page = fs.readFileSync(paymentsPagePath, 'utf8');
  assert.match(roster, /or\(and\(eq\(staff\.active, true\), eq\(staff\.archived, false\)\), inArray\(staff\.id, chargedStaff\)\)/);
  assert.match(items, /\.where\(offenceBookRosterWhere\(monthEnd\)\)/);
  assert.match(exportRoute, /\.where\(offenceBookRosterWhere\(monthEnd\)\)/);
  assert.match(page, /<BalanceStat label="Penalties"/);
  assert.match(page, /label="Pardoned"/);
  assert.doesNotMatch(page, /label="Owed"/);
});

test('an admin can undo a mistaken payment, with a reason that is audited', () => {
  const route = fs.readFileSync(path.join(root, 'src/app/api/payments/lateness/[paymentId]/route.ts'), 'utf8');
  const page = fs.readFileSync(paymentsPagePath, 'utf8');
  const audit = fs.readFileSync(path.join(root, 'src/app/audit-trail/page.tsx'), 'utf8');
  assert.match(route, /const authError = await enforceRole\(\['admin'\]\);/);
  assert.match(route, /if \(!reason\) \{\s*return NextResponse\.json\(\{ error: 'Say why this payment is being undone' \}, \{ status: 400 \}\);/);
  assert.match(route, /await db\.delete\(latenessPayment\)\.where\(eq\(latenessPayment\.id, payment\.id\)\);/);
  assert.match(route, /before: \{ \.\.\.payment, allocations, staffName: member\?\.fullName \|\| null \},\s*after: \{ reason, undone: true \}/);
  assert.match(page, /disabled=\{undoing \|\| !undoReason\.trim\(\)\}/);
  assert.match(audit, /Undid GHC \$\{amount\} payment for/);
  // Credits are not a thing: kept cash is corrected, not carried.
  assert.doesNotMatch(fs.readFileSync(paymentsApiPath, 'utf8'), /credit/i);
});
