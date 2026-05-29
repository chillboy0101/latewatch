import ExcelJS from 'exceljs';
import { format, parseISO } from 'date-fns';
import path from 'path';
import { getMonthWorkingWeeks } from '@/lib/export-weeks';

export const OFFENCE_BOOK_ITEM_LIMITS = {
  opening_balance: 1,
  closing_balance: 1,
  external_money: 4,
  expenditure: 9,
} as const;

export const OFFENCE_BOOK_TEMPLATE_PATH = path.join(
  process.cwd(),
  'src',
  'payment-templates',
  'offence-book.xlsx',
);

export type OffenceBookItemType = keyof typeof OFFENCE_BOOK_ITEM_LIMITS;

export type OffenceBookItemInput = {
  amount: number | string | null;
  displayOrder?: number | null;
  itemType: OffenceBookItemType;
  label: string;
  monthKey: string;
};

export type OffenceBookStaffInput = {
  fullName: string;
  id: string;
};

export type OffenceBookEntryInput = {
  computedAmount: number | string | null;
  date: string;
  id: string;
  staffId: string;
};

export type OffenceBookAllocationInput = {
  allocatedAmount: number | string | null;
  entryId: string;
};

export type BuildOffenceBookWorkbookInput = {
  allocations: OffenceBookAllocationInput[];
  entries: OffenceBookEntryInput[];
  items: OffenceBookItemInput[];
  month: number;
  staff: OffenceBookStaffInput[];
  templatePath?: string;
  year: number;
};

export type OffenceBookFinancialSummary = {
  calculatedClosingBalance: string;
  calculatedClosingBalanceCents: number;
  closingBalance: string;
  closingBalanceCents: number;
  expenditure: string;
  expenditureCents: number;
  externalMoney: string;
  externalMoneyCents: number;
  openingBalance: string;
  openingBalanceCents: number;
  savedClosingBalance: string;
  savedClosingBalanceCents: number | null;
  totalPaid: string;
  totalPaidCents: number;
  totalPenalty: string;
  totalPenaltyCents: number;
  totalUnpaid: string;
  totalUnpaidCents: number;
};

const MAX_TEMPLATE_STAFF_ROWS = 16;
const WEEK_BLOCK_TITLE_ROWS = [4, 25, 46, 67, 88];
const WEEKDAY_AMOUNT_COLUMNS = [4, 5, 6, 7, 8];
const TOTAL_COLUMN = 10;
const STATUS_COLUMN = 11;
const PAID_COLUMN = 13;
const UNPAID_COLUMN = 14;
const STAFF_NUMBER_COLUMN = 2;
const STAFF_NAME_COLUMN = 3;
const PAYMENT_STATUS_COLUMN_MIN_WIDTH = 24;
const WEEK_HEADER_LABELS: Array<[number, string]> = [
  [STAFF_NAME_COLUMN, 'NAME'],
  [4, 'MONDAY'],
  [5, 'TUESDAY'],
  [6, 'WEDNESDAY'],
  [7, 'THURSDAY'],
  [8, 'FRIDAY'],
  [9, 'PENALTY'],
  [TOTAL_COLUMN, 'TOTAL'],
  [STATUS_COLUMN, 'STATUS'],
  [PAID_COLUMN, 'PAID'],
  [UNPAID_COLUMN, 'UNPAID'],
];
const EXTERNAL_MONEY_ROWS = [8, 9, 10, 11];
const EXPENDITURE_ROWS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUMMARY_GRID_BORDER: Partial<ExcelJS.Border> = {
  color: { argb: 'FFBFBFBF' },
  style: 'thin',
};
const SUMMARY_COLUMN_WIDTHS = {
  expenditureAmount: 14,
  expenditureItem: 44,
  externalSource: 34,
  owedName: 34,
  staffName: 34,
};

function amountNumber(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function cents(value: number | string | null | undefined) {
  return Math.round(amountNumber(value) * 100);
}

function money(centsValue: number) {
  return Number((centsValue / 100).toFixed(2));
}

function moneyText(centsValue: number) {
  return (centsValue / 100).toFixed(2);
}

function cloneStyle(style: Partial<ExcelJS.Style>) {
  return JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>;
}

function monthStartKey(year: number, month: number) {
  return format(new Date(year, month, 1), 'yyyy-MM-dd');
}

function monthEndKey(year: number, month: number) {
  return format(new Date(year, month + 1, 0), 'yyyy-MM-dd');
}

function previousMonthStartKey(year: number, month: number) {
  return format(new Date(year, month - 1, 1), 'yyyy-MM-dd');
}

function dateKey(value: string | Date) {
  return value instanceof Date ? format(value, 'yyyy-MM-dd') : value.slice(0, 10);
}

function dateColumn(date: string) {
  const day = parseISO(date).getDay();
  if (day < 1 || day > 5) return null;
  return WEEKDAY_AMOUNT_COLUMNS[day - 1];
}

function ordinalSuffix(value: number) {
  if (value > 3 && value < 21) return 'TH';
  switch (value % 10) {
    case 1: return 'ST';
    case 2: return 'ND';
    case 3: return 'RD';
    default: return 'TH';
  }
}

function dateLabel(date: Date, includeMonthYear: boolean) {
  const dayName = format(date, 'EEEE').toUpperCase();
  const day = date.getDate();
  const suffix = ordinalSuffix(day);
  const monthYear = includeMonthYear ? ` ${format(date, 'MMMM yyyy').toUpperCase()}` : '';
  return `${dayName}, ${day}${suffix}${monthYear}`;
}

function weekTitle(weekNumber: number, dates: string[]) {
  const start = parseISO(dates[0]);
  const end = parseISO(dates[dates.length - 1]);

  if (dates.length === 1) {
    return `WEEK ${weekNumber} ${dateLabel(start, true)}`;
  }

  return `WEEK ${weekNumber} ${dateLabel(start, false)} - ${dateLabel(end, true)}`;
}

function paidCentsByEntry(allocations: OffenceBookAllocationInput[]) {
  const totals = new Map<string, number>();

  for (const allocation of allocations) {
    const paid = cents(allocation.allocatedAmount);
    if (paid <= 0) continue;
    totals.set(allocation.entryId, (totals.get(allocation.entryId) || 0) + paid);
  }

  return totals;
}

function formulaValue(formula: string, result: number): ExcelJS.CellFormulaValue {
  return { formula, result: money(result) };
}

function writeFormula(cell: ExcelJS.Cell, formula: string, resultCents: number) {
  cell.value = formulaValue(formula, resultCents);
  cell.numFmt = '#,##0.00';
}

function setStrike(cell: ExcelJS.Cell, strike: boolean) {
  const style = cloneStyle(cell.style || {});
  style.font = {
    ...(style.font || {}),
    strike,
  };
  cell.style = style;
}

function setBold(cell: ExcelJS.Cell, bold: boolean) {
  const style = cloneStyle(cell.style || {});
  style.font = {
    ...(style.font || {}),
    bold,
  };
  cell.style = style;
}

function setAmountCell(cell: ExcelJS.Cell, centsValue: number, strike = false) {
  cell.value = centsValue > 0 ? money(centsValue) : null;
  cell.numFmt = '#,##0.00';
  setStrike(cell, strike);
}

function paymentStatus(rowPenaltyCents: number, rowPaidCents: number, rowUnpaidCents: number) {
  if (rowPenaltyCents <= 0) return null;
  if (rowUnpaidCents <= 0) return 'PAID';
  if (rowPaidCents > 0) return 'PARTIALLY PAID';
  return 'UNPAID';
}

function monthItems(items: OffenceBookItemInput[], itemType: OffenceBookItemType, monthKey: string) {
  return items
    .filter((item) => item.itemType === itemType && dateKey(item.monthKey) === monthKey)
    .slice()
    .sort((left, right) => (left.displayOrder || 0) - (right.displayOrder || 0));
}

function entryAmountCents(entry: OffenceBookEntryInput) {
  return Math.max(0, cents(entry.computedAmount));
}

function entryPaidCents(entry: OffenceBookEntryInput, paidByEntry: Map<string, number>) {
  return Math.min(entryAmountCents(entry), paidByEntry.get(entry.id) || 0);
}

function sumEntryBalanceCents(
  entries: OffenceBookEntryInput[],
  paidByEntry: Map<string, number>,
  predicate: (entry: OffenceBookEntryInput) => boolean,
) {
  return entries
    .filter(predicate)
    .reduce((total, entry) => total + Math.max(0, entryAmountCents(entry) - entryPaidCents(entry, paidByEntry)), 0);
}

function summarizeWeeklyFinancialTotals(input: {
  allocations: OffenceBookAllocationInput[];
  entries: OffenceBookEntryInput[];
  month: number;
  staff: OffenceBookStaffInput[];
  year: number;
}) {
  const selectedMonthKey = monthStartKey(input.year, input.month);
  const selectedMonthEnd = monthEndKey(input.year, input.month);
  const paidByEntry = paidCentsByEntry(input.allocations);
  const selectedEntries = input.entries.filter((entry) => entry.date >= selectedMonthKey && entry.date <= selectedMonthEnd);
  const selectedEntriesByStaffDate = new Map<string, OffenceBookEntryInput[]>();

  for (const entry of selectedEntries) {
    const key = `${entry.staffId}:${dateKey(entry.date)}`;
    const list = selectedEntriesByStaffDate.get(key) || [];
    list.push(entry);
    selectedEntriesByStaffDate.set(key, list);
  }

  return getMonthWorkingWeeks(input.year, input.month).reduce(
    (totals, week) => {
      const weekDates = new Set(week.dates);
      for (const member of input.staff) {
        for (const date of weekDates) {
          const dayEntries = selectedEntriesByStaffDate.get(`${member.id}:${date}`) || [];
          const dayPenaltyCents = dayEntries.reduce((sum, entry) => sum + entryAmountCents(entry), 0);
          const dayPaidCents = dayEntries.reduce((sum, entry) => sum + entryPaidCents(entry, paidByEntry), 0);
          totals.penaltyCents += dayPenaltyCents;
          totals.paidCents += dayPaidCents;
          totals.unpaidCents += Math.max(0, dayPenaltyCents - dayPaidCents);
        }
      }

      return totals;
    },
    { paidCents: 0, penaltyCents: 0, unpaidCents: 0 },
  );
}

export function calculateOffenceBookFinancialSummary({
  allocations,
  entries,
  items,
  month,
  staff,
  year,
}: Omit<BuildOffenceBookWorkbookInput, 'templatePath'>): OffenceBookFinancialSummary {
  const selectedMonthKey = monthStartKey(year, month);
  const paidByEntry = paidCentsByEntry(allocations);
  const calculatedOpeningBalanceCents = sumEntryBalanceCents(
    entries,
    paidByEntry,
    (entry) => dateKey(entry.date) < selectedMonthKey,
  );
  const openingBalanceItems = monthItems(items, 'opening_balance', selectedMonthKey);
  const previousClosingBalanceItems = monthItems(items, 'closing_balance', previousMonthStartKey(year, month));
  const openingBalanceCents = openingBalanceItems.length > 0
    ? cents(openingBalanceItems[0].amount)
    : previousClosingBalanceItems.length > 0
      ? cents(previousClosingBalanceItems[0].amount)
    : calculatedOpeningBalanceCents;
  const externalMoneyCents = monthItems(items, 'external_money', selectedMonthKey)
    .reduce((sum, item) => sum + cents(item.amount), 0);
  const expenditureCents = monthItems(items, 'expenditure', selectedMonthKey)
    .reduce((sum, item) => sum + cents(item.amount), 0);
  const weeklyTotals = summarizeWeeklyFinancialTotals({ allocations, entries, month, staff, year });
  const calculatedClosingBalanceCents = openingBalanceCents + externalMoneyCents + weeklyTotals.paidCents - expenditureCents;
  const closingBalanceItems = monthItems(items, 'closing_balance', selectedMonthKey);
  const savedClosingBalanceCents = closingBalanceItems.length > 0 ? cents(closingBalanceItems[0].amount) : null;

  return {
    calculatedClosingBalance: moneyText(calculatedClosingBalanceCents),
    calculatedClosingBalanceCents,
    closingBalance: moneyText(calculatedClosingBalanceCents),
    closingBalanceCents: calculatedClosingBalanceCents,
    expenditure: moneyText(expenditureCents),
    expenditureCents,
    externalMoney: moneyText(externalMoneyCents),
    externalMoneyCents,
    openingBalance: moneyText(openingBalanceCents),
    openingBalanceCents,
    savedClosingBalance: savedClosingBalanceCents == null ? '' : moneyText(savedClosingBalanceCents),
    savedClosingBalanceCents,
    totalPaid: moneyText(weeklyTotals.paidCents),
    totalPaidCents: weeklyTotals.paidCents,
    totalPenalty: moneyText(weeklyTotals.penaltyCents),
    totalPenaltyCents: weeklyTotals.penaltyCents,
    totalUnpaid: moneyText(weeklyTotals.unpaidCents),
    totalUnpaidCents: weeklyTotals.unpaidCents,
  };
}

function cellRangeFormula(column: string, rows: number[]) {
  return `SUM(${rows.map((row) => `${column}${row}`).join(',')})`;
}

function clearBlockRows(worksheet: ExcelJS.Worksheet, titleRow: number) {
  const dataStart = titleRow + 2;
  for (let offset = 0; offset < MAX_TEMPLATE_STAFF_ROWS; offset++) {
    const rowNumber = dataStart + offset;
    for (let column = STAFF_NUMBER_COLUMN; column <= UNPAID_COLUMN; column++) {
      worksheet.getCell(rowNumber, column).value = null;
    }
  }
}

function applyWeeklyHeaderRow(worksheet: ExcelJS.Worksheet, titleRow: number) {
  const headerRow = titleRow + 1;
  for (const [column, label] of WEEK_HEADER_LABELS) {
    const cell = worksheet.getCell(headerRow, column);
    cell.value = label;
    setBold(cell, true);
  }
}

function widenColumn(worksheet: ExcelJS.Worksheet, column: number, minimumWidth: number) {
  const target = worksheet.getColumn(column);
  target.width = Math.max(target.width || 0, minimumWidth);
}

function applySummaryGridLines(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
) {
  for (let row = startRow; row <= endRow; row++) {
    for (let column = startColumn; column <= endColumn; column++) {
      worksheet.getCell(row, column).border = {
        bottom: SUMMARY_GRID_BORDER,
        left: SUMMARY_GRID_BORDER,
        right: SUMMARY_GRID_BORDER,
        top: SUMMARY_GRID_BORDER,
      };
    }
  }
}

function applySummaryBlockLayout(worksheet: ExcelJS.Worksheet) {
  widenColumn(worksheet, STATUS_COLUMN, PAYMENT_STATUS_COLUMN_MIN_WIDTH);
  widenColumn(worksheet, STAFF_NAME_COLUMN, SUMMARY_COLUMN_WIDTHS.staffName);
  widenColumn(worksheet, 16, SUMMARY_COLUMN_WIDTHS.owedName);
  widenColumn(worksheet, 17, SUMMARY_COLUMN_WIDTHS.externalSource);
  widenColumn(worksheet, 18, SUMMARY_COLUMN_WIDTHS.expenditureItem);
  widenColumn(worksheet, 19, SUMMARY_COLUMN_WIDTHS.expenditureAmount);
  applySummaryGridLines(worksheet, 4, 5, 16, 16);
  applySummaryGridLines(worksheet, 7, 12, 16, 17);
  applySummaryGridLines(worksheet, 14, 15, 16, 16);
  applySummaryGridLines(worksheet, 17, 18, 16, 16);
  applySummaryGridLines(worksheet, 4, 15, 18, 19);
  applySummaryGridLines(worksheet, 4, 5, 20, 20);
  applySummaryGridLines(worksheet, 7, 8, 20, 20);
  applySummaryGridLines(worksheet, 10, 11, 20, 20);
}

export async function buildOffenceBookWorkbookFromData({
  allocations,
  entries,
  items,
  month,
  staff,
  templatePath = OFFENCE_BOOK_TEMPLATE_PATH,
  year,
}: BuildOffenceBookWorkbookInput) {
  if (staff.length > MAX_TEMPLATE_STAFF_ROWS) {
    throw new Error(`OFFENCE BOOK template supports up to ${MAX_TEMPLATE_STAFF_ROWS} staff rows`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  workbook.creator = 'LateWatch';
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('OFFENCE BOOK template sheet not found');

  const selectedMonthKey = monthStartKey(year, month);
  const selectedMonthEnd = monthEndKey(year, month);
  const sheetName = format(new Date(year, month, 1), 'MMMM yyyy').toUpperCase();
  worksheet.name = sheetName.slice(0, 31);

  const paidByEntry = paidCentsByEntry(allocations);
  const selectedEntries = entries.filter((entry) => entry.date >= selectedMonthKey && entry.date <= selectedMonthEnd);
  const selectedEntriesByStaffDate = new Map<string, OffenceBookEntryInput[]>();
  for (const entry of selectedEntries) {
    const key = `${entry.staffId}:${dateKey(entry.date)}`;
    const list = selectedEntriesByStaffDate.get(key) || [];
    list.push(entry);
    selectedEntriesByStaffDate.set(key, list);
  }

  const calculatedOpeningBalanceCents = sumEntryBalanceCents(
    entries,
    paidByEntry,
    (entry) => dateKey(entry.date) < selectedMonthKey,
  );
  const openingBalanceItems = monthItems(items, 'opening_balance', selectedMonthKey);
  const previousClosingBalanceItems = monthItems(items, 'closing_balance', previousMonthStartKey(year, month));
  const openingBalanceCents = openingBalanceItems.length > 0
    ? cents(openingBalanceItems[0].amount)
    : previousClosingBalanceItems.length > 0
      ? cents(previousClosingBalanceItems[0].amount)
    : calculatedOpeningBalanceCents;
  const owedThroughMonthByStaff = new Map<string, number>();
  for (const member of staff) {
    owedThroughMonthByStaff.set(member.id, sumEntryBalanceCents(
      entries.filter((entry) => entry.staffId === member.id),
      paidByEntry,
      (entry) => dateKey(entry.date) <= selectedMonthEnd,
    ));
  }

  const weeklyTotals = WEEK_BLOCK_TITLE_ROWS.map(() => ({
    paidCents: 0,
    penaltyCents: 0,
    unpaidCents: 0,
  }));

  const weeks = getMonthWorkingWeeks(year, month);
  for (let weekIndex = 0; weekIndex < WEEK_BLOCK_TITLE_ROWS.length; weekIndex++) {
    const titleRow = WEEK_BLOCK_TITLE_ROWS[weekIndex];
    const week = weeks[weekIndex];
    clearBlockRows(worksheet, titleRow);
    applyWeeklyHeaderRow(worksheet, titleRow);

    const titleCell = worksheet.getCell(titleRow, STAFF_NAME_COLUMN);
    titleCell.value = week ? weekTitle(week.weekNumber, week.dates) : null;

    const dataStart = titleRow + 2;
    const totalRow = titleRow + 19;
    const weekDates = new Set(week?.dates || []);

    for (let staffIndex = 0; staffIndex < staff.length; staffIndex++) {
      const row = dataStart + staffIndex;
      const member = staff[staffIndex];
      worksheet.getCell(row, STAFF_NUMBER_COLUMN).value = staffIndex + 1;
      worksheet.getCell(row, STAFF_NAME_COLUMN).value = member.fullName;

      let rowPenaltyCents = 0;
      let rowPaidCents = 0;
      for (const date of weekDates) {
        const column = dateColumn(date);
        if (!column) continue;
        const dayEntries = selectedEntriesByStaffDate.get(`${member.id}:${date}`) || [];
        const dayPenaltyCents = dayEntries.reduce((sum, entry) => sum + entryAmountCents(entry), 0);
        const dayPaidCents = dayEntries.reduce((sum, entry) => sum + entryPaidCents(entry, paidByEntry), 0);

        rowPenaltyCents += dayPenaltyCents;
        rowPaidCents += dayPaidCents;
        setAmountCell(worksheet.getCell(row, column), dayPenaltyCents, dayPenaltyCents > 0 && dayPaidCents >= dayPenaltyCents);
      }

      const rowUnpaidCents = Math.max(0, rowPenaltyCents - rowPaidCents);
      writeFormula(worksheet.getCell(row, TOTAL_COLUMN), `SUM(D${row}:I${row})`, rowPenaltyCents);
      worksheet.getCell(row, STATUS_COLUMN).value = paymentStatus(rowPenaltyCents, rowPaidCents, rowUnpaidCents);
      setAmountCell(worksheet.getCell(row, PAID_COLUMN), rowPaidCents);
      writeFormula(worksheet.getCell(row, UNPAID_COLUMN), `J${row}-M${row}`, rowUnpaidCents);

      weeklyTotals[weekIndex].penaltyCents += rowPenaltyCents;
      weeklyTotals[weekIndex].paidCents += rowPaidCents;
      weeklyTotals[weekIndex].unpaidCents += rowUnpaidCents;
    }

    worksheet.getCell(totalRow, STAFF_NAME_COLUMN).value = 'TOTAL';
    for (let column = 4; column <= 9; column++) {
      const columnLetter = worksheet.getColumn(column).letter;
      const columnTotalCents = Array.from({ length: staff.length }, (_, index) => {
        const value = amountNumber(worksheet.getCell(dataStart + index, column).value as string | number | null);
        return cents(value);
      }).reduce((sum, value) => sum + value, 0);
      writeFormula(worksheet.getCell(totalRow, column), `SUM(${columnLetter}${dataStart}:${columnLetter}${dataStart + staff.length - 1})`, columnTotalCents);
    }
    writeFormula(worksheet.getCell(totalRow, TOTAL_COLUMN), `SUM(J${dataStart}:J${dataStart + staff.length - 1})`, weeklyTotals[weekIndex].penaltyCents);
    writeFormula(worksheet.getCell(totalRow, PAID_COLUMN), `SUM(M${dataStart}:M${dataStart + staff.length - 1})`, weeklyTotals[weekIndex].paidCents);
    writeFormula(worksheet.getCell(totalRow, UNPAID_COLUMN), `SUM(N${dataStart}:N${dataStart + staff.length - 1})`, weeklyTotals[weekIndex].unpaidCents);
  }

  const externalMoneyItems = monthItems(items, 'external_money', selectedMonthKey);
  const expenditureItems = monthItems(items, 'expenditure', selectedMonthKey);
  const externalMoneyCents = externalMoneyItems.reduce((sum, item) => sum + cents(item.amount), 0);
  const expenditureCents = expenditureItems.reduce((sum, item) => sum + cents(item.amount), 0);
  const totalPenaltyCents = weeklyTotals.reduce((sum, week) => sum + week.penaltyCents, 0);
  const totalPaidCents = weeklyTotals.reduce((sum, week) => sum + week.paidCents, 0);
  const totalUnpaidCents = weeklyTotals.reduce((sum, week) => sum + week.unpaidCents, 0);
  const calculatedClosingBalanceCents = openingBalanceCents + externalMoneyCents + totalPaidCents - expenditureCents;

  worksheet.getCell('P5').value = money(openingBalanceCents);
  worksheet.getCell('P5').numFmt = '#,##0.00';

  for (const [index, row] of EXTERNAL_MONEY_ROWS.entries()) {
    const item = externalMoneyItems[index];
    worksheet.getCell(row, 16).value = item ? amountNumber(item.amount) : null;
    worksheet.getCell(row, 16).numFmt = '#,##0.00';
    worksheet.getCell(row, 17).value = item?.label || null;
  }
  writeFormula(worksheet.getCell('P12'), 'SUM(P8:P11)', externalMoneyCents);
  writeFormula(worksheet.getCell('P15'), cellRangeFormula('J', WEEK_BLOCK_TITLE_ROWS.map((row) => row + 19)), totalPenaltyCents);
  writeFormula(worksheet.getCell('P18'), cellRangeFormula('M', WEEK_BLOCK_TITLE_ROWS.map((row) => row + 19)), totalPaidCents);
  writeFormula(worksheet.getCell('P23'), cellRangeFormula('N', WEEK_BLOCK_TITLE_ROWS.map((row) => row + 19)), totalUnpaidCents);

  for (const [index, row] of EXPENDITURE_ROWS.entries()) {
    const item = expenditureItems[index];
    worksheet.getCell(row, 18).value = item?.label || null;
    worksheet.getCell(row, 19).value = item ? amountNumber(item.amount) : null;
    worksheet.getCell(row, 19).numFmt = '#,##0.00';
  }
  writeFormula(worksheet.getCell('S15'), 'SUM(S6:S14)', expenditureCents);
  writeFormula(worksheet.getCell('T5'), 'SUM(P5,P12,P15)-S15', openingBalanceCents + externalMoneyCents + totalPenaltyCents - expenditureCents);
  writeFormula(worksheet.getCell('T8'), 'SUM(P5,P12,P18)', openingBalanceCents + externalMoneyCents + totalPaidCents);
  writeFormula(worksheet.getCell('T11'), 'SUM(P5,P12,P18)-S15', calculatedClosingBalanceCents);

  const owedHighlightNameStyle = cloneStyle(worksheet.getCell('P27').style);
  const owedHighlightAmountStyle = cloneStyle(worksheet.getCell('Q27').style);
  const owedPlainNameStyle = cloneStyle(worksheet.getCell('P26').style);
  const owedPlainAmountStyle = cloneStyle(worksheet.getCell('Q26').style);
  for (let index = 0; index < MAX_TEMPLATE_STAFF_ROWS; index++) {
    const row = 26 + index;
    const member = staff[index];
    const owedCents = member ? owedThroughMonthByStaff.get(member.id) || 0 : 0;
    const nameCell = worksheet.getCell(row, 16);
    const amountCell = worksheet.getCell(row, 17);
    nameCell.style = cloneStyle(owedCents > 0 ? owedHighlightNameStyle : owedPlainNameStyle);
    amountCell.style = cloneStyle(owedCents > 0 ? owedHighlightAmountStyle : owedPlainAmountStyle);
    nameCell.value = member?.fullName || null;
    amountCell.value = member ? money(owedCents) : null;
    amountCell.numFmt = '#,##0.00';
  }

  applySummaryBlockLayout(worksheet);

  return workbook;
}
