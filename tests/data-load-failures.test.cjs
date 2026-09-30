/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPage = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/page.tsx'), 'utf8');
const entriesPage = fs.readFileSync(path.join(__dirname, '../src/app/entries/page.tsx'), 'utf8');
const paymentsPage = fs.readFileSync(path.join(__dirname, '../src/app/payments/page.tsx'), 'utf8');

test('dashboard reports failed data requests instead of rendering zero defaults', () => {
  assert.match(dashboardPage, /if \(!res\.ok\) throw new Error/);
  assert.match(dashboardPage, /if \(!stats\)/);
  assert.match(dashboardPage, /Dashboard data could not be loaded/);
  assert.match(dashboardPage, /onClick=\{\(\) => void fetchDashboardData\(\)\}/);
  assert.match(dashboardPage, /Showing the last successful results/);
});

test('entries page checks all data responses before rendering its grid', () => {
  assert.match(entriesPage, /\[staffResponse, calendarResponse, entriesResponse\]\.find\(\(response\) => !response\.ok\)/);
  assert.match(entriesPage, /Entries could not be loaded/);
  assert.match(entriesPage, /onClick=\{\(\) => void fetchStaffAndEntries\(\)\}/);
});

test('offence-book load failures preserve drafts and block saving the unloaded month', () => {
  const loadHandler = paymentsPage.match(/const loadOffenceBookItems = [\s\S]*?\n  \}, \[offenceBookMonth, offenceBookYear\]\);/);

  assert.ok(loadHandler);
  assert.doesNotMatch(loadHandler[0], /set(?:ExternalMoney|Expenditure)Drafts\(\[createOffenceBookDraftItem\(\)\]\)/);
  assert.match(paymentsPage, /loadedOffenceBookKey === `\$\{offenceBookYear\}-\$\{offenceBookMonth\}`/);
  assert.match(paymentsPage, /disabled=\{!offenceBookReady \|\| offenceBookSaving\}/);
});