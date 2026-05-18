/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const entriesPagePath = path.join(__dirname, '../src/app/entries/page.tsx');
const entriesRoutePath = path.join(__dirname, '../src/app/api/entries/route.ts');
const recalculateScriptPath = path.join(__dirname, '../scripts/recalculate-regular-staff-penalties.mjs');

test('entries page live penalty calculation preserves monitoring-only staff rules', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly\?: boolean \| null/);
  assert.match(source, /isAttendanceOnly: member\?\.isAttendanceOnly === true/);
});

test('entries page exposes an icon-only refresh button beside save entries', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /RefreshCw/);
  assert.match(source, /aria-label="Refresh entries"/);
  assert.match(source, /onClick=\{\(\) => \{\s*setMessage\(null\);\s*void fetchStaffAndEntries\(\);\s*\}\}/);
  assert.match(source, /<RefreshCw className="h-4 w-4" \/>/);
});

test('entries page uses general entries wording instead of lateness-only labels', () => {
  const pageSource = fs.readFileSync(entriesPagePath, 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../src/components/layout/sidebar.tsx'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '../src/components/layout/app-shell.tsx'), 'utf8');
  const exportsPageSource = fs.readFileSync(path.join(__dirname, '../src/app/exports/page.tsx'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(__dirname, '../src/app/settings/page.tsx'), 'utf8');

  assert.match(pageSource, /DashboardLayout title="Entries"/);
  assert.match(pageSource, /Save Entries/);
  assert.match(sidebarSource, /name: 'Entries'/);
  assert.match(sidebarSource, /name: 'Exports'/);
  assert.match(sidebarSource, /name: 'Payments'/);
  assert.match(shellSource, /entries: 'Entries'/);
  assert.match(shellSource, /exports: 'Exports'/);
  assert.match(shellSource, /payments: 'Payments'/);
  assert.match(settingsSource, /href="\/exports" label="Exports"/);
  assert.match(exportsPageSource, /DashboardLayout title="Exports"/);
  assert.match(exportsPageSource, />Lateness Exports</);
  assert.match(exportsPageSource, />Attendance Exports</);
  assert.doesNotMatch(pageSource, /Save Lateness Entries/);
  assert.doesNotMatch(sidebarSource, /Lateness Entries/);
  assert.doesNotMatch(sidebarSource, /Lateness Exports/);
  assert.doesNotMatch(sidebarSource, /Penalty Payments/);
  assert.doesNotMatch(shellSource, /Lateness Entries/);
  assert.doesNotMatch(shellSource, /Lateness Exports/);
  assert.doesNotMatch(shellSource, /Penalty Payments/);
});

test('entries page omits removed manual message queue controls', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const brand = ['Whats', 'App'].join('');
  const apiSegment = ['/api/', ['what', 'sapp'].join('')].join('');
  const queueSymbol = `${brand}NoticeQueue`;

  assert.doesNotMatch(source, new RegExp(`Send ${brand} Notices`));
  assert.doesNotMatch(source, new RegExp(apiSegment));
  assert.doesNotMatch(source, new RegExp(queueSymbol));
});

test('entries page shows general pardon in the amount column for pardoned rows', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isGeneralPardon/);
  assert.match(source, />General pardon</);
});

test('entries API sources saved arrival times from attendance records', () => {
  const source = fs.readFileSync(entriesRoutePath, 'utf8');

  assert.match(source, /checkInTime: attendanceRecord\.checkInTime/);
  assert.match(source, /mergeAttendanceRowsIntoEntryRows\(\{ attendanceRows, entryRows: entries, permissionRows \}\)/);
});

test('regular staff recalculation apply notifies live pages to refetch entries', () => {
  const source = fs.readFileSync(recalculateScriptPath, 'utf8');

  assert.match(source, /async function publishInvalidation/);
  assert.match(source, /latewatch:\$\{channel\}/);
  assert.match(source, /'entries'/);
  assert.match(source, /'attendance'/);
  assert.match(source, /'dashboard'/);
});
