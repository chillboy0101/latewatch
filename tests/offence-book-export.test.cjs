/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

require('tsx/cjs');

const {
  buildOffenceBookWorkbookFromData,
  calculateOffenceBookFinancialSummary,
  OFFENCE_BOOK_TEMPLATE_PATH,
} = require('../src/lib/offence-book-export.ts');

const staff = [
  { fullName: 'Active One', id: 'staff-1' },
  { fullName: 'Active Two', id: 'staff-2' },
  { fullName: 'Active Three', id: 'staff-3' },
];

const entries = [
  {
    computedAmount: '15.00',
    date: '2026-04-30',
    id: 'entry-before',
    staffId: 'staff-2',
  },
  {
    computedAmount: '20.00',
    date: '2026-05-04',
    id: 'entry-1',
    staffId: 'staff-1',
  },
  {
    computedAmount: '10.00',
    date: '2026-05-05',
    id: 'entry-2',
    staffId: 'staff-1',
  },
  {
    computedAmount: '10.00',
    date: '2026-05-25',
    id: 'entry-3',
    staffId: 'staff-2',
  },
];

const allocations = [
  { allocatedAmount: '5.00', entryId: 'entry-before' },
  { allocatedAmount: '20.00', entryId: 'entry-1' },
  { allocatedAmount: '10.00', entryId: 'entry-3' },
];

const items = [
  {
    amount: '1000.00',
    displayOrder: 1,
    itemType: 'external_money',
    label: 'Donation',
    monthKey: '2026-05-01',
  },
  {
    amount: '50.00',
    displayOrder: 1,
    itemType: 'expenditure',
    label: 'TnT',
    monthKey: '2026-05-01',
  },
];

function resultOf(value) {
  if (value && typeof value === 'object' && 'formula' in value && !('result' in value)) return 0;
  return value && typeof value === 'object' && 'result' in value ? value.result : value;
}

function fillArgb(cell) {
  return cell.fill?.fgColor?.argb || null;
}

function isStruck(cell) {
  return cell.font?.strike === true;
}

function borderStyle(cell, edge) {
  return cell.border?.[edge]?.style || null;
}

function borderSnapshot(cell) {
  return {
    bottom: borderStyle(cell, 'bottom'),
    left: borderStyle(cell, 'left'),
    right: borderStyle(cell, 'right'),
    top: borderStyle(cell, 'top'),
  };
}

function assertThinGrid(cell, label) {
  assert.equal(borderStyle(cell, 'bottom'), 'thin', `${label} should show a bottom grid line`);
  assert.equal(borderStyle(cell, 'left'), 'thin', `${label} should show a left grid line`);
  assert.equal(borderStyle(cell, 'right'), 'thin', `${label} should show a right grid line`);
  assert.equal(borderStyle(cell, 'top'), 'thin', `${label} should show a top grid line`);
}

function formulaTexts(workbook) {
  const formulas = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell.value;
        if (value && typeof value === 'object' && 'formula' in value) {
          formulas.push(value.formula);
        }
      });
    });
  }
  return formulas;
}

async function buildWorkbook() {
  return buildOffenceBookWorkbookFromData({
    allocations,
    entries,
    items,
    month: 4,
    staff,
    templatePath: OFFENCE_BOOK_TEMPLATE_PATH,
    year: 2026,
  });
}

async function buildWorkbookWithStaff(customStaff) {
  return buildOffenceBookWorkbookFromData({
    allocations: [],
    entries: [],
    items: [],
    month: 4,
    staff: customStaff,
    templatePath: OFFENCE_BOOK_TEMPLATE_PATH,
    year: 2026,
  });
}

async function loadTemplateSheet() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(OFFENCE_BOOK_TEMPLATE_PATH);
  return workbook.worksheets[0];
}

test('offence book financial summary exposes the calculated closing balance for payment inputs', () => {
  const summary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items,
    month: 4,
    staff,
    year: 2026,
  });

  assert.equal(summary.openingBalance, '10.00');
  assert.equal(summary.calculatedClosingBalance, '990.00');
  assert.equal(summary.closingBalance, '990.00');
});

test('offence book financial summary ignores a stray closing_balance item — closing balance is always calculated', () => {
  const summary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items: [
      ...items,
      {
        amount: '555.00',
        displayOrder: 0,
        itemType: 'closing_balance',
        label: 'Closing balance',
        monthKey: '2026-05-01',
      },
    ],
    month: 4,
    staff,
    year: 2026,
  });

  assert.equal(summary.calculatedClosingBalance, '990.00');
  assert.equal(summary.closingBalance, '990.00');
  assert.equal(summary.savedClosingBalance, undefined);
});

test('offence book export preserves template layout and fills monthly payment values', async () => {
  const workbook = await buildWorkbook();
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);
  assert.equal(sheet.getCell('C4').value, 'WEEK 1 FRIDAY, 1ST MAY 2026');
  assert.equal(sheet.getCell('C25').value, 'WEEK 2 MONDAY, 4TH - FRIDAY, 8TH MAY 2026');
  assert.equal(sheet.getCell('C88').value, 'WEEK 5 MONDAY, 25TH - FRIDAY, 29TH MAY 2026');
  assert.equal(fillArgb(sheet.getCell('C4')), 'FF434343');
  assert.ok((sheet.model.merges || []).includes('C4:L4'));

  assert.equal(sheet.getCell('B27').value, 1);
  assert.equal(sheet.getCell('C27').value, 'Active One');
  assert.equal(sheet.getCell('D27').value, 20);
  assert.equal(sheet.getCell('E27').value, 10);
  assert.equal(resultOf(sheet.getCell('J27').value), 30);
  assert.equal(sheet.getCell('M27').value, 20);
  assert.equal(resultOf(sheet.getCell('N27').value), 10);
  assert.equal(sheet.getCell('K27').value, 'PARTIALLY PAID');
  assert.equal(isStruck(sheet.getCell('D27')), true);
  assert.equal(isStruck(sheet.getCell('E27')), false);

  assert.equal(sheet.getCell('C91').value, 'Active Two');
  assert.equal(sheet.getCell('D91').value, 10);
  assert.equal(sheet.getCell('M91').value, 10);
  assert.equal(resultOf(sheet.getCell('N91').value), 0);
  assert.equal(sheet.getCell('K91').value, 'PAID');
  assert.equal(isStruck(sheet.getCell('D91')), true);

  assert.equal(sheet.getCell('P5').value, 10);
  assert.equal(sheet.getCell('P8').value, 1000);
  assert.equal(sheet.getCell('Q8').value, 'Donation');
  assert.equal(sheet.getCell('R6').value, 'TnT');
  assert.equal(sheet.getCell('S6').value, 50);
  assert.equal(resultOf(sheet.getCell('P15').value), 40);
  assert.equal(resultOf(sheet.getCell('P18').value), 30);
  assert.equal(resultOf(sheet.getCell('S15').value), 50);
  assert.equal(resultOf(sheet.getCell('T5').value), 1000);
  assert.equal(resultOf(sheet.getCell('T8').value), 1040);
  assert.equal(resultOf(sheet.getCell('T11').value), 990);
});

test('offence book export calculates amount owed and preserves owed highlighting', async () => {
  const workbook = await buildWorkbook();
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);
  assert.equal(sheet.getCell('P26').value, 'Active One');
  assert.equal(sheet.getCell('Q26').value, 10);
  assert.equal(fillArgb(sheet.getCell('P26')), 'FFFF00FF');
  assert.equal(fillArgb(sheet.getCell('Q26')), 'FFFF00FF');

  assert.equal(sheet.getCell('P27').value, 'Active Two');
  assert.equal(sheet.getCell('Q27').value, 10);
  assert.equal(fillArgb(sheet.getCell('P27')), 'FFFF00FF');
  assert.equal(fillArgb(sheet.getCell('Q27')), 'FFFF00FF');

  assert.equal(sheet.getCell('P28').value, 'Active Three');
  assert.equal(sheet.getCell('Q28').value, 0);
  assert.notEqual(fillArgb(sheet.getCell('P28')), 'FFFF00FF');
  assert.notEqual(fillArgb(sheet.getCell('Q28')), 'FFFF00FF');
});

test('offence book weekly table headers are complete and bold in every block', async () => {
  const workbook = await buildWorkbook();
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);

  const expectedHeaders = [
    [3, 'NAME'],
    [4, 'MONDAY'],
    [5, 'TUESDAY'],
    [6, 'WEDNESDAY'],
    [7, 'THURSDAY'],
    [8, 'FRIDAY'],
    [9, 'PENALTY'],
    [10, 'TOTAL'],
    [11, 'STATUS'],
    [13, 'PAID'],
    [14, 'UNPAID'],
  ];

  for (const row of [5, 26, 47, 68, 89]) {
    for (const [column, label] of expectedHeaders) {
      const cell = sheet.getCell(row, column);
      assert.equal(String(cell.value || '').trim(), label, `${cell.address} should show ${label}`);
      assert.equal(cell.font?.bold, true, `${cell.address} should be bold`);
    }
  }
});

test('offence book colored summary blocks show grid lines without touching the weekly table', async () => {
  const workbook = await buildWorkbook();
  const sheet = workbook.getWorksheet('MAY 2026');
  const template = await loadTemplateSheet();

  assert.ok(sheet);
  assert.ok(sheet.getColumn(17).width >= 34, 'external money source column should be wide enough');
  assert.ok(sheet.getColumn(18).width >= 44, 'expenditure item column should be wide enough');
  assert.ok(sheet.getColumn(19).width >= 14, 'expenditure amount column should be wide enough');
  assert.ok(sheet.getColumn(11).width >= 24, 'weekly payment status column should fit PARTIALLY PAID');
  assert.equal(sheet.getColumn(13).width, template.getColumn(13).width, 'weekly paid column should keep the template width');
  assert.equal(sheet.getColumn(14).width, template.getColumn(14).width, 'weekly unpaid column should keep the template width');

  for (const [startRow, endRow, startColumn, endColumn] of [
    [4, 5, 16, 16],
    [7, 12, 16, 17],
    [14, 15, 16, 16],
    [17, 18, 16, 16],
    [4, 15, 18, 19],
    [4, 5, 20, 20],
    [7, 8, 20, 20],
    [10, 11, 20, 20],
  ]) {
    for (let row = startRow; row <= endRow; row++) {
      for (let column = startColumn; column <= endColumn; column++) {
        const cell = sheet.getCell(row, column);
        assertThinGrid(cell, cell.address);
      }
    }
  }

  for (const address of ['P22', 'P23', 'C6', 'K27']) {
    assert.deepEqual(
      borderSnapshot(sheet.getCell(address)),
      borderSnapshot(template.getCell(address)),
      `${address} should keep the offence book template borders`,
    );
  }

  assert.deepEqual(sheet.getCell('B27').border || {}, {});
  assert.deepEqual(sheet.getCell('C27').border || {}, {});
});

test('offence book export uses saved opening balance input when present', async () => {
  const workbook = await buildOffenceBookWorkbookFromData({
    allocations,
    entries,
    items: [
      ...items,
      {
        amount: '777.00',
        displayOrder: 0,
        itemType: 'closing_balance',
        label: 'Closing balance',
        monthKey: '2026-04-01',
      },
      {
        amount: '250.00',
        displayOrder: 0,
        itemType: 'opening_balance',
        label: 'Opening balance',
        monthKey: '2026-05-01',
      },
    ],
    month: 4,
    staff,
    templatePath: OFFENCE_BOOK_TEMPLATE_PATH,
    year: 2026,
  });
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);
  assert.equal(sheet.getCell('P5').value, 250);
  assert.equal(resultOf(sheet.getCell('T5').value), 1240);
  assert.equal(resultOf(sheet.getCell('T8').value), 1280);
  assert.equal(resultOf(sheet.getCell('T11').value), 1230);
});

test('offence book export carries the previous month\'s live closing balance into next month\'s opening balance', async () => {
  const workbook = await buildOffenceBookWorkbookFromData({
    allocations,
    entries,
    items: [
      ...items,
      {
        amount: '1000.00',
        displayOrder: 0,
        itemType: 'opening_balance',
        label: 'Opening balance',
        monthKey: '2026-04-01',
      },
    ],
    month: 4,
    staff,
    templatePath: OFFENCE_BOOK_TEMPLATE_PATH,
    year: 2026,
  });
  const sheet = workbook.getWorksheet('MAY 2026');

  // April's live closing balance = its 1000.00 opening anchor plus the 5.00
  // payment recorded against "entry-before" (dated 2026-04-30) — 1005.00 —
  // not a separately-saved closing balance snapshot for April.
  assert.ok(sheet);
  assert.equal(sheet.getCell('P5').value, 1005);
});

test('offence book financial summary carries the previous month\'s live closing balance forward with no saved closing_balance item', () => {
  const aprilSummary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items: [
      {
        amount: '1000.00',
        displayOrder: 0,
        itemType: 'opening_balance',
        label: 'Opening balance',
        monthKey: '2026-04-01',
      },
    ],
    month: 3,
    staff,
    year: 2026,
  });
  const maySummary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items: [
      {
        amount: '1000.00',
        displayOrder: 0,
        itemType: 'opening_balance',
        label: 'Opening balance',
        monthKey: '2026-04-01',
      },
      ...items,
    ],
    month: 4,
    staff,
    year: 2026,
  });

  assert.equal(aprilSummary.calculatedClosingBalance, '1005.00');
  assert.equal(maySummary.openingBalance, aprilSummary.calculatedClosingBalance);
});

test('offence book export keeps current closing balance calculated when saved closing input exists', async () => {
  const workbook = await buildOffenceBookWorkbookFromData({
    allocations,
    entries,
    items: [
      ...items,
      {
        amount: '555.00',
        displayOrder: 0,
        itemType: 'closing_balance',
        label: 'Closing balance',
        monthKey: '2026-05-01',
      },
    ],
    month: 4,
    staff,
    templatePath: OFFENCE_BOOK_TEMPLATE_PATH,
    year: 2026,
  });
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);
  assert.equal(sheet.getCell('P5').value, 10);
  assert.equal(resultOf(sheet.getCell('T11').value), 990);
});

test('offence book staff name columns are wide enough for full names without styling the main table', async () => {
  const longName = 'DENNIS AKUETTEH ARYEETEY';
  const workbook = await buildWorkbookWithStaff([{ fullName: longName, id: 'staff-long-name' }]);
  const sheet = workbook.getWorksheet('MAY 2026');

  assert.ok(sheet);
  assert.equal(sheet.getCell('C6').value, longName);
  assert.equal(sheet.getCell('P26').value, longName);
  assert.ok(sheet.getColumn(3).width >= 34, 'weekly staff name column should fit full names');
  assert.ok(sheet.getColumn(16).width >= 34, 'amount owed staff name column should fit full names');
  assert.deepEqual(sheet.getCell('C6').border || {}, {});
});

test('offence book export is standalone and can be re-opened without external workbook references', async () => {
  const workbook = await buildWorkbook();
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(Buffer.from(buffer));

  assert.equal(reopened.worksheets.length, 1);
  assert.equal(reopened.worksheets[0].name, 'MAY 2026');
  for (const formula of formulaTexts(reopened)) {
    assert.doesNotMatch(formula, /\[[^\]]+\.?xlsx?\]/i);
  }
});
