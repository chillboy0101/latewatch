/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

require('tsx/cjs');

const {
  buildOffenceBookWorkbookFromData,
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
