/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'src/db/schema.ts');
const migrationPath = path.join(root, 'drizzle/0024_offence_book_items.sql');
const seedMigrationPath = path.join(root, 'src/app/api/seed/migrate/route.ts');
const itemsApiPath = path.join(root, 'src/app/api/payments/offence-book-items/route.ts');
const exportRoutePath = path.join(root, 'src/app/api/export/offence-book/route.ts');
const exportsPagePath = path.join(root, 'src/app/exports/page.tsx');
const paymentsPagePath = path.join(root, 'src/app/payments/page.tsx');
const exportLibPath = path.join(root, 'src/lib/offence-book-export.ts');

test('offence book item storage is defined in schema, migration, and seed repair', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seedMigration = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.equal(fs.existsSync(migrationPath), true);
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(schema, /export const offenceBookItem = pgTable\('offence_book_item'/);
  assert.match(schema, /itemType: text\('item_type'\)\.notNull\(\)/);
  assert.match(schema, /monthKey: date\('month_key'\)\.notNull\(\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS offence_book_item/);
  assert.match(migration, /offence_book_item_month_type_order_idx/);
  assert.match(seedMigration, /CREATE TABLE IF NOT EXISTS offence_book_item/);
});

test('offence book items API supports monthly database-backed input editing', () => {
  assert.equal(fs.existsSync(itemsApiPath), true);
  const source = fs.readFileSync(itemsApiPath, 'utf8');

  assert.match(source, /export async function GET/);
  assert.match(source, /export async function PUT/);
  assert.match(source, /OFFENCE_BOOK_ITEM_LIMITS/);
  assert.match(source, /openingBalance/);
  assert.match(source, /closingBalance/);
  assert.match(source, /opening_balance/);
  assert.match(source, /closing_balance/);
  assert.match(source, /external_money/);
  assert.match(source, /expenditure/);
  assert.match(source, /publishRealtime\('payments'/);
  assert.match(source, /entityType: 'offence_book_item'/);
});

test('exports and payments pages expose offence book controls', () => {
  const exportsPage = fs.readFileSync(exportsPagePath, 'utf8');
  const paymentsPage = fs.readFileSync(paymentsPagePath, 'utf8');

  assert.match(exportsPage, /OFFENCE BOOK EXPORT/);
  assert.match(exportsPage, /handleOffenceBookExport/);
  assert.match(exportsPage, /\/api\/export\/offence-book/);
  assert.match(exportsPage, /type: 'offence-book'/);

  assert.match(paymentsPage, /Offence book inputs/);
  assert.match(paymentsPage, /Opening Balance/);
  assert.match(paymentsPage, /Closing Balance/);
  assert.match(paymentsPage, /openingBalance/);
  assert.match(paymentsPage, /closingBalance/);
  assert.match(paymentsPage, /externalMoneyDrafts/);
  assert.match(paymentsPage, /expenditureDrafts/);
  assert.match(paymentsPage, /\/api\/payments\/offence-book-items/);
  assert.match(paymentsPage, /External Money/);
  assert.match(paymentsPage, /Expenditure/);
});

test('offence book export route uses the template and audit/export wiring', () => {
  assert.equal(fs.existsSync(exportRoutePath), true);
  assert.equal(fs.existsSync(exportLibPath), true);
  const route = fs.readFileSync(exportRoutePath, 'utf8');
  const lib = fs.readFileSync(exportLibPath, 'utf8');

  assert.match(route, /buildOffenceBookExportWorkbook/);
  assert.match(route, /tryWriteAuditEvent/);
  assert.match(route, /entityType: 'export'/);
  assert.match(route, /OFFENCE_BOOK_/);
  assert.match(lib, /payment-templates/);
  assert.match(lib, /offence-book\.xlsx/);
  assert.match(lib, /OFFENCE_BOOK_ITEM_LIMITS/);
  assert.match(lib, /opening_balance/);
  assert.match(lib, /closing_balance/);
  assert.match(lib, /buildOffenceBookWorkbookFromData/);
});
