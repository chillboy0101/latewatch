/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const {
  countLateArrivals,
  countSignOutEntries,
  summarizeLatenessExportEntries,
  sumAmounts,
} = require('../src/lib/lateness-export-summary.ts');

const exportsPagePath = path.join(__dirname, '../src/app/exports/page.tsx');
const summaryRoutePath = path.join(__dirname, '../src/app/api/export/lateness-summary/route.ts');
const attendanceExportRoutePath = path.join(__dirname, '../src/app/api/export/attendance/route.ts');

const {
  getAttendanceExportTemplatesForGroup,
  isAttendanceExportTemplateAllowedForGroup,
} = require('../src/lib/attendance-export-shared.ts');

test('lateness export summary ignores non-penalty presentation rows', () => {
  const rows = [
    {
      computedAmount: '0.00',
      didNotSignOut: false,
      reason: null,
    },
    {
      computedAmount: '0.00',
      didNotSignOut: false,
      reason: 'Excused absence: Official duty',
    },
    {
      computedAmount: '0.00',
      didNotSignOut: false,
      reason: 'General pardon',
    },
    {
      computedAmount: '0.00',
      didNotSignOut: false,
      reason: 'No sign-out waived',
    },
  ];

  assert.equal(countLateArrivals(rows), 0);
  assert.equal(countSignOutEntries(rows), 0);
  assert.equal(sumAmounts(rows), 0);
  assert.deepEqual(summarizeLatenessExportEntries(rows), {
    lateArrivals: 0,
    signOut: 0,
    amount: 0,
  });
});

test('lateness export summary counts positive late penalties and amount', () => {
  const rows = [
    {
      computedAmount: '10.00',
      didNotSignOut: false,
      reason: "DIDN'T COME BEFORE 8:30AM",
    },
    {
      computedAmount: '15.00',
      didNotSignOut: false,
      reason: "DIDN'T COME BEFORE 8:30AM",
    },
  ];

  assert.equal(countLateArrivals(rows), 2);
  assert.equal(countSignOutEntries(rows), 0);
  assert.equal(sumAmounts(rows), 25);
  assert.deepEqual(summarizeLatenessExportEntries(rows), {
    lateArrivals: 2,
    signOut: 0,
    amount: 25,
  });
});

test('lateness export summary separates no-sign-out-only penalties from late arrivals', () => {
  const rows = [
    {
      computedAmount: '2.00',
      didNotSignOut: true,
      reason: 'DID NOT SIGN OUT',
    },
  ];

  assert.equal(countLateArrivals(rows), 0);
  assert.equal(countSignOutEntries(rows), 1);
  assert.equal(sumAmounts(rows), 2);
  assert.deepEqual(summarizeLatenessExportEntries(rows), {
    lateArrivals: 0,
    signOut: 1,
    amount: 2,
  });
});

test('lateness export summary counts combined late and no-sign-out rows in both buckets once', () => {
  const rows = [
    {
      computedAmount: '17.00',
      didNotSignOut: true,
      reason: "DIDN'T COME BEFORE 8:30AM AND DID NOT SIGN OUT",
    },
  ];

  assert.equal(countLateArrivals(rows), 1);
  assert.equal(countSignOutEntries(rows), 1);
  assert.equal(sumAmounts(rows), 17);
  assert.deepEqual(summarizeLatenessExportEntries(rows), {
    lateArrivals: 1,
    signOut: 1,
    amount: 17,
  });
});

test('lateness export summary includes no-show amount without late or sign-out counts', () => {
  const rows = [
    {
      computedAmount: '50.00',
      didNotSignOut: false,
      reason: "DIDN'T SIGN IN BEFORE 4:30PM",
    },
  ];

  assert.equal(countLateArrivals(rows), 0);
  assert.equal(countSignOutEntries(rows), 0);
  assert.equal(sumAmounts(rows), 50);
  assert.deepEqual(summarizeLatenessExportEntries(rows), {
    lateArrivals: 0,
    signOut: 0,
    amount: 50,
  });
});

test('lateness summary API is database-sourced and syncs before reading totals', () => {
  assert.equal(fs.existsSync(summaryRoutePath), true);
  const source = fs.readFileSync(summaryRoutePath, 'utf8');

  assert.match(source, /syncLatenessEntriesFromAttendanceForRange/);
  assert.match(source, /from\(latenessEntry\)/);
  assert.match(source, /getMonthWorkingWeeks/);
  assert.match(source, /summarizeLatenessExportEntries/);
  assert.match(source, /url\.searchParams\.get\('year'\)/);
  assert.match(source, /url\.searchParams\.get\('month'\)/);
});

test('exports page fetches database-backed lateness summary instead of entries presentation rows', () => {
  const source = fs.readFileSync(exportsPagePath, 'utf8');

  assert.match(source, /\/api\/export\/lateness-summary\?year=\$\{selectedYear\}&month=\$\{selectedMonthIndex\}/);
  assert.doesNotMatch(source, /\/api\/entries\?start=/);
  assert.doesNotMatch(source, /function countLateArrivals\(entries: ExportEntry\[\]\) \{\s*return entries\.length;\s*\}/);
});

test('attendance export templates limit NSS personnel to weekly validation', () => {
  assert.deepEqual(getAttendanceExportTemplatesForGroup('main'), [
    'daily-summary',
    'weekly-validation',
    'monthly-matrix',
  ]);
  assert.deepEqual(getAttendanceExportTemplatesForGroup('nss'), ['weekly-validation']);
  assert.equal(isAttendanceExportTemplateAllowedForGroup('nss', 'weekly-validation'), true);
  assert.equal(isAttendanceExportTemplateAllowedForGroup('nss', 'daily-summary'), false);
  assert.equal(isAttendanceExportTemplateAllowedForGroup('nss', 'monthly-matrix'), false);
});

test('exports page and API enforce weekly validation for NSS personnel', () => {
  const pageSource = fs.readFileSync(exportsPagePath, 'utf8');
  const routeSource = fs.readFileSync(attendanceExportRoutePath, 'utf8');

  assert.match(pageSource, /getAttendanceExportTemplatesForGroup\(attendanceGroup\)/);
  assert.match(pageSource, /selectedAttendanceTemplate/);
  assert.match(pageSource, /setAttendanceTemplate\(selectedAttendanceTemplate\)/);
  assert.match(routeSource, /isAttendanceExportTemplateAllowedForGroup\(group, template\)/);
  assert.match(routeSource, /getAttendanceExportTemplateRestrictionMessage/);
});
