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
const paymentsPagePath = path.join(root, 'src/app/payments/page.tsx');
const checkInPagePath = path.join(root, 'src/app/check-in/page.tsx');
const sidebarPath = path.join(root, 'src/components/layout/sidebar.tsx');
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
  assert.match(source, /latenessPaymentAllocation/);
  assert.match(source, /entityType: 'lateness_payment'/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /Payment amount exceeds outstanding balance/);
});

test('staff penalty history endpoint is scoped to the signed-in staff member', () => {
  assert.equal(fs.existsSync(penaltyHistoryApiPath), true);
  const source = fs.readFileSync(penaltyHistoryApiPath, 'utf8');

  assert.match(source, /currentUser\(\)/);
  assert.match(source, /resolveMemberForPenaltyHistory/);
  assert.match(source, /eq\(latenessEntry\.staffId, member\.id\)/);
  assert.match(source, /summarizePenaltyHistoryWeeks/);
  assert.doesNotMatch(source, /searchParams\.get\('staffId'\)/);
});

test('admin payments page and navigation expose payment management actions', () => {
  assert.equal(fs.existsSync(paymentsPagePath), true);
  const page = fs.readFileSync(paymentsPagePath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const proxy = fs.readFileSync(proxyPath, 'utf8');

  assert.match(page, /Penalty Payments/);
  assert.match(page, /Record payment/);
  assert.match(page, /Pay balance/);
  assert.match(page, /Mark paid/);
  assert.match(page, /Manage/);
  assert.match(page, /DialogContent/);
  assert.match(page, /weekRangeLabel/);
  assert.match(page, /sortPaymentRowsByBalance/);
  assert.match(page, /\/api\/payments\/lateness/);
  assert.doesNotMatch(page, /Record full or partial lateness payments and keep staff balances transparent/);
  assert.doesNotMatch(page, />Roster</);
  assert.doesNotMatch(page, /<h1[^>]*>Penalty Payments<\/h1>/);
  assert.doesNotMatch(page, /xl:grid-cols/);
  assert.doesNotMatch(page, />Owed<\/th>/);
  assert.doesNotMatch(page, />Paid<\/th>/);
  assert.match(sidebar, /Penalty Payments/);
  assert.match(sidebar, /href: '\/payments'/);
  assert.match(proxy, /\/payments\(\.\*\)/);
  assert.match(proxy, /\/api\/payments\(\.\*\)/);
});

test('check-in page exposes an icon-only penalty history modal', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /Penalty History/);
  assert.match(source, /aria-label="Penalty History"/);
  assert.match(source, /\/api\/attendance\/check-in\/penalty-history/);
  assert.match(source, /Current week/);
  assert.match(source, /Outstanding balance/);
});
