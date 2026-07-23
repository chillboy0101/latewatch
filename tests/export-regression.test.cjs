/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const ExcelJS = require('exceljs');

const originalLoad = Module._load;

const fixture = {
  entries: [],
  holidays: [],
  staffRows: [],
};

function resetFixture({ entries = [], holidays = [], staffRows = [] } = {}) {
  fixture.entries = entries;
  fixture.holidays = holidays;
  fixture.staffRows = staffRows;
}

function collectParams(value, params = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return params;

  if (Array.isArray(value)) {
    for (const item of value) collectParams(item, params, seen);
    return params;
  }

  if (seen.has(value)) return params;
  seen.add(value);

  if (value.constructor?.name === 'Param') {
    if (Array.isArray(value.value)) {
      params.push(...value.value);
    } else {
      params.push(value.value);
    }
    return params;
  }

  if (Array.isArray(value.queryChunks)) {
    for (const chunk of value.queryChunks) collectParams(chunk, params, seen);
  }

  if (Array.isArray(value.value)) {
    for (const item of value.value) collectParams(item, params, seen);
  }

  return params;
}

function getDateBounds(condition) {
  const params = collectParams(condition);
  const dates = params.filter((param) => typeof param === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(param));
  return {
    end: dates[1] || dates[0] || '9999-12-31',
    start: dates[0] || '0000-01-01',
  };
}

function inDateRange(row, start, end) {
  return row.date >= start && row.date <= end;
}

function exportStaffRows(condition) {
  const params = collectParams(condition);
  const requestedHistoricalIds = new Set(
    params.filter((param) => typeof param === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(param)),
  );

  return fixture.staffRows
    .filter((member) => (member.active === true && member.archived !== true) || requestedHistoricalIds.has(member.id))
    .map((member) => ({ id: member.id, fullName: member.fullName }));
}

const fakeDb = {
  select(selection) {
    const keys = Object.keys(selection || {});
    const selectionType = keys.includes('fullName')
      ? 'staff'
      : keys.includes('arrivalTime')
      ? 'entries'
      : keys.includes('count')
      ? 'staff-count'
      : 'holidays';

    return {
      from() {
        return {
          where(condition) {
            if (selectionType === 'staff') {
              return {
                orderBy: async () => exportStaffRows(condition),
              };
            }

            if (selectionType === 'staff-count') {
              return Promise.resolve([{ count: exportStaffRows(condition).length }]);
            }

            const { start, end } = getDateBounds(condition);

            if (selectionType === 'entries') {
              return Promise.resolve(fixture.entries.filter((entry) => inDateRange(entry, start, end)));
            }

            return Promise.resolve(fixture.holidays.filter((holiday) => inDateRange(holiday, start, end)));
          },
        };
      },
    };
  },
};

Module._load = function patchedLoad(request, ...args) {
  if (request === 'server-only') return {};
  if (request === '@/db') return { db: fakeDb };
  if (request === '@/lib/audit') {
    return {
      getAuditActor: async () => ({ actorEmail: 'test@example.com', actorUserId: null }),
      tryWriteAuditEvent: async () => null,
    };
  }
  if (request === '@/lib/auth/roles') {
    return {
      enforceRole: async () => null,
    };
  }
  if (request === '@/lib/attendance-lateness-sync') {
    return {
      syncLatenessEntriesFromAttendanceForRange: async () => ({ inserted: 0, updated: 0 }),
    };
  }

  return originalLoad.call(this, request, ...args);
};

require('tsx/cjs');

const { buildWeeklyWorkbook } = require('../src/app/api/export/weekly/route.ts');
const { POST: buildMonthlyWorkbookResponse } = require('../src/app/api/export/monthly/route.ts');

const activeStaff = [
  { id: 'staff-1', fullName: 'ACTIVE STAFF ONE', active: true, archived: false },
  { id: 'staff-2', fullName: 'ACTIVE STAFF TWO', active: true, archived: false },
];

function fillArgb(cell) {
  return cell.fill?.fgColor?.argb || null;
}

function titleRowsVisible(sheet) {
  return [1, 19, 37, 55, 73].filter((row) => !sheet.getRow(row).hidden);
}

function titleRowsHidden(sheet) {
  return [1, 19, 37, 55, 73].filter((row) => sheet.getRow(row).hidden);
}

async function buildMayMonthlyWorkbook() {
  const response = await buildMonthlyWorkbookResponse(new Request('http://localhost/api/export/monthly', {
    body: JSON.stringify({ month: 4, year: 2026 }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  if (!response.ok) {
    assert.fail(await response.text());
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  return workbook;
}

test('the source template stays blank and reusable', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('src/lateness-book.xlsx');
  const sheet = workbook.worksheets[0];

  assert.equal(sheet.name, 'TEMPLATE');
  assert.equal(sheet.getCell(1, 1).value, null);
  assert.equal(sheet.getCell(4, 1).value, null);
  assert.equal(sheet.getCell(95, 1).value, null);
  assert.equal(sheet.getCell(95, 2).value, null);
  assert.equal(sheet.getCell(110, 1).value, 'TOTAL:');
  assert.deepEqual([1, 2, 3, 4].map((col) => sheet.getCell(3, col).value), ['NAME', 'TIME', 'AMOUNT', 'REASON']);
  assert.equal(fillArgb(sheet.getCell(1, 1)), 'FFC0C0C0');
});

test('weekly export compacts a partial week to only valid dates', async () => {
  resetFixture({ staffRows: activeStaff });

  const workbook = await buildWeeklyWorkbook('2026-05-01', '2026-05-01', null, undefined, undefined, undefined, 1);
  const sheet = workbook.worksheets[0];

  assert.equal(sheet.name, 'WEEK 1');
  assert.equal(sheet.getCell(1, 1).value, 'FRIDAY, 1ST MAY 2026');
  assert.deepEqual([1, 2, 3, 4].map((col) => sheet.getCell(3, col).value), ['NAME', 'TIME', 'AMOUNT', 'REASON']);
  assert.deepEqual(titleRowsVisible(sheet), [1]);
  assert.deepEqual(titleRowsHidden(sheet), [19, 37, 55, 73]);
  assert.equal(sheet.getCell(4, 1).value, 'ACTIVE STAFF ONE');
  assert.equal(sheet.getCell(22, 1).value, null);
  assert.equal(fillArgb(sheet.getCell(1, 1)), 'FFC0C0C0');
});

test('weekly export fills a full working week with entries and totals', async () => {
  resetFixture({
    entries: [
      {
        arrivalTime: '09:20',
        computedAmount: '20.00',
        date: '2026-05-04',
        reason: 'Late arrival',
        staffId: 'staff-1',
      },
    ],
    staffRows: activeStaff,
  });

  const workbook = await buildWeeklyWorkbook('2026-05-04', '2026-05-08', null, undefined, undefined, undefined, 2);
  const sheet = workbook.worksheets[0];

  assert.equal(sheet.name, 'WEEK 2');
  assert.deepEqual(titleRowsVisible(sheet), [1, 19, 37, 55, 73]);
  assert.deepEqual(
    [1, 19, 37, 55, 73].map((row) => sheet.getCell(row, 1).value),
    [
      'MONDAY, 4TH MAY 2026',
      'TUESDAY, 5TH MAY 2026',
      'WEDNESDAY, 6TH MAY 2026',
      'THURSDAY, 7TH MAY 2026',
      'FRIDAY, 8TH MAY 2026',
    ],
  );
  assert.equal(sheet.getCell(4, 1).value, 'ACTIVE STAFF ONE');
  assert.ok(sheet.getCell(4, 2).value instanceof Date);
  assert.equal(sheet.getCell(4, 3).value, 20);
  assert.equal(sheet.getCell(4, 4).value, 'Late arrival');
  assert.deepEqual(sheet.getCell(95, 2).value, { formula: 'SUM(C4,C22,C40,C58,C76)', result: 20 });
  assert.deepEqual(sheet.getCell(96, 2).value, { formula: 'SUM(C5,C23,C41,C59,C77)' });
  assert.deepEqual(sheet.getCell(110, 2).value, { formula: 'SUM(B95:B96)', result: 20 });
});

test('weekly export includes archived staff only when they have historical entries', async () => {
  resetFixture({
    entries: [
      {
        arrivalTime: '09:35',
        computedAmount: '30.00',
        date: '2026-05-04',
        reason: 'Late arrival',
        staffId: 'archived-with-entry',
      },
    ],
    staffRows: [
      ...activeStaff,
      { id: 'archived-with-entry', fullName: 'ARCHIVED WITH ENTRY', active: false, archived: true },
      { id: 'archived-without-entry', fullName: 'ARCHIVED WITHOUT ENTRY', active: false, archived: true },
    ],
  });

  const historicalWorkbook = await buildWeeklyWorkbook('2026-05-04', '2026-05-08', null, undefined, undefined, undefined, 2);
  const historicalNames = [4, 5, 6, 7].map((row) => historicalWorkbook.worksheets[0].getCell(row, 1).value).filter(Boolean);

  assert.deepEqual(historicalNames, ['ACTIVE STAFF ONE', 'ACTIVE STAFF TWO', 'ARCHIVED WITH ENTRY']);

  resetFixture({
    staffRows: [
      ...activeStaff,
      { id: 'archived-with-entry', fullName: 'ARCHIVED WITH ENTRY', active: false, archived: true },
      { id: 'archived-without-entry', fullName: 'ARCHIVED WITHOUT ENTRY', active: false, archived: true },
    ],
  });

  const futureWorkbook = await buildWeeklyWorkbook('2026-05-11', '2026-05-15', null, undefined, undefined, undefined, 3);
  const futureNames = [4, 5, 6, 7].map((row) => futureWorkbook.worksheets[0].getCell(row, 1).value).filter(Boolean);

  assert.deepEqual(futureNames, ['ACTIVE STAFF ONE', 'ACTIVE STAFF TWO']);
});

test('monthly export creates correct May 2026 sheets and preserves partial week layout', async () => {
  resetFixture({ staffRows: activeStaff });

  const workbook = await buildMayMonthlyWorkbook();
  const [week1, week2, , , week5] = workbook.worksheets;

  assert.equal(workbook.worksheets.length, 5);
  assert.equal(week1.name, 'Week 1 01 May-01 May');
  assert.equal(week1.getCell(1, 1).value, 'FRIDAY, 1ST MAY 2026');
  assert.deepEqual(titleRowsVisible(week1), [1]);
  assert.deepEqual(titleRowsHidden(week1), [19, 37, 55, 73]);
  assert.equal(fillArgb(week1.getCell(1, 1)), 'FFC0C0C0');

  assert.equal(week2.name, 'Week 2 04 May-08 May');
  assert.equal(week2.getCell(1, 1).value, 'MONDAY, 4TH MAY 2026');
  assert.equal(week2.getCell(73, 1).value, 'FRIDAY, 8TH MAY 2026');
  assert.equal(fillArgb(week2.getCell(1, 1)), 'FFC0C0C0');
  assert.deepEqual(week2.getCell(95, 2).value, { formula: 'SUM(C4,C22,C40,C58,C76)' });

  assert.equal(week5.name, 'Week 5 25 May-29 May');
});

test('monthly export preserves visible cached weekly penalty totals', async () => {
  resetFixture({
    entries: [
      {
        arrivalTime: '09:20',
        computedAmount: '20.00',
        date: '2026-05-04',
        reason: 'Late arrival',
        staffId: 'staff-1',
      },
    ],
    staffRows: activeStaff,
  });

  const workbook = await buildMayMonthlyWorkbook();
  const week2 = workbook.worksheets[1];

  assert.equal(week2.name, 'Week 2 04 May-08 May');
  assert.deepEqual(week2.getCell(95, 2).value, { formula: 'SUM(C4,C22,C40,C58,C76)', result: 20 });
  assert.deepEqual(week2.getCell(110, 2).value, { formula: 'SUM(B95:B96)', result: 20 });
});

test('weekly export expands safely beyond the 15-row template roster', async () => {
  resetFixture({
    staffRows: Array.from({ length: 16 }, (_, index) => ({
      active: true,
      archived: false,
      fullName: `STAFF ${index + 1}`,
      id: `staff-${index + 1}`,
    })),
  });

  const workbook = await buildWeeklyWorkbook('2026-05-04', '2026-05-08', null, undefined, undefined, undefined, 2);
  const sheet = workbook.worksheets[0];

  assert.equal(sheet.getCell(19, 1).value, 'STAFF 16');
  assert.equal(sheet.getCell(20, 1).value, 'TUESDAY, 5TH MAY 2026');
  assert.deepEqual([1, 2, 3, 4].map((col) => sheet.getCell(22, col).value), ['NAME', 'TIME', 'AMOUNT', 'REASON']);
  assert.equal(sheet.getCell(23, 1).value, 'STAFF 1');
  assert.equal(sheet.getCell(116, 1).value, 'TOTAL:');
  assert.deepEqual(sheet.getCell(116, 2).value, { formula: 'SUM(B100:B115)' });
  assert.equal(fillArgb(sheet.getCell(20, 1)), 'FFC0C0C0');
});
