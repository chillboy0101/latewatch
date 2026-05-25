/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const {
  buildContributionWorkbookFromData,
} = require('../src/lib/contribution-export.ts');

const schemaPath = path.join(__dirname, '../src/db/schema.ts');
const migrationPath = path.join(__dirname, '../drizzle/0023_contributions.sql');
const seedMigrationPath = path.join(__dirname, '../src/app/api/seed/migrate/route.ts');
const apiPath = path.join(__dirname, '../src/app/api/contributions/route.ts');
const exportRoutePath = path.join(__dirname, '../src/app/api/export/contributions/route.ts');
const pagePath = path.join(__dirname, '../src/app/contributions/page.tsx');
const sidebarPath = path.join(__dirname, '../src/components/layout/sidebar.tsx');

const contributionSections = [
  {
    displayOrder: 1,
    entries: [
      { amount: '200.00', contributorName: 'Charles Dogbatse', displayOrder: 1, id: 'e1', note: null },
      { amount: '100.00', contributorName: 'Esther Adjorkor Adjei', displayOrder: 2, id: 'e2', note: null },
    ],
    id: 's1',
    title: "WISDOM'S CONTRIBUTION",
    totalAmount: '300.00',
  },
  {
    displayOrder: 2,
    entries: [
      { amount: '100.00', contributorName: 'Claude Kwasi Boadi', displayOrder: 1, id: 'e3', note: 'to be reimbursed' },
    ],
    id: 's2',
    title: "RAPHAEL'S CONTRIBUTION",
    totalAmount: '100.00',
  },
];

test('contributions schema, migration, and seed repair are defined', () => {
  const schemaSource = fs.readFileSync(schemaPath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const seedMigrationSource = fs.readFileSync(seedMigrationPath, 'utf8');

  assert.match(schemaSource, /export const contributionSection = pgTable\('contribution_section'/);
  assert.match(schemaSource, /export const contributionEntry = pgTable\('contribution_entry'/);
  assert.match(schemaSource, /amount: decimal\('amount'/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS contribution_section/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS contribution_entry/);
  assert.match(migrationSource, /WISDOM'S CONTRIBUTION/);
  assert.match(migrationSource, /RAPHAEL'S CONTRIBUTION/);
  assert.match(migrationSource, /MADAM SOPHIA'S CONTRIBUTION/);
  assert.match(seedMigrationSource, /CREATE TABLE IF NOT EXISTS contribution_section/);
  assert.match(seedMigrationSource, /MADAM SOPHIA'S CONTRIBUTION/);
});

test('contributions page and API expose database CRUD and export wiring', () => {
  const apiSource = fs.readFileSync(apiPath, 'utf8');
  const exportRouteSource = fs.readFileSync(exportRoutePath, 'utf8');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(apiSource, /export async function GET/);
  assert.match(apiSource, /export async function POST/);
  assert.match(apiSource, /export async function PATCH/);
  assert.match(apiSource, /export async function DELETE/);
  assert.match(apiSource, /publishRealtime\('contributions'/);
  assert.match(exportRouteSource, /buildContributionExportWorkbook/);
  assert.match(pageSource, /fetch\('\/api\/contributions'/);
  assert.match(pageSource, /\/api\/export\/contributions/);
  assert.match(pageSource, /Create section/);
  assert.match(pageSource, /Save/);
  assert.match(pageSource, /Delete/);
  assert.match(sidebarSource, /Contributions/);
  assert.match(sidebarSource, /href: '\/contributions'/);
});

test('contribution export workbook preserves sections, totals, and notes', async () => {
  const workbook = await buildContributionWorkbookFromData({
    sections: contributionSections,
    year: 2026,
  });
  const sheet = workbook.getWorksheet('2026 CONTRIBUTIONS');

  assert.ok(sheet);
  assert.equal(sheet.getCell('B2').value, "WISDOM'S CONTRIBUTION");
  assert.equal(sheet.getCell('A4').value, 'No.');
  assert.equal(sheet.getCell('B4').value, 'Name');
  assert.equal(sheet.getCell('C4').value, 'Amount');
  assert.equal(sheet.getCell('A6').value, 1);
  assert.equal(sheet.getCell('B6').value, 'Charles Dogbatse');
  assert.equal(sheet.getCell('C6').value, 200);
  assert.equal(sheet.getCell('B9').value, 'TOTAL');
  assert.deepEqual(sheet.getCell('C9').value, { formula: 'SUM(C6:C7)' });
  assert.equal(sheet.getCell('B13').value, "RAPHAEL'S CONTRIBUTION");
  assert.equal(sheet.getCell('D17').value, 'to be reimbursed');
});
