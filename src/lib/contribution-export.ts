import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import type { ContributionSectionRecord } from '@/lib/contributions';

type BuildContributionWorkbookInput = {
  sections: ContributionSectionRecord[];
  year?: number;
};

const BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
  top: { style: 'thin' },
};

function amountNumber(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function contributionTotal(entries: Array<{ amount: string | number | null | undefined }>) {
  return entries
    .reduce((total, entry) => total + amountNumber(entry.amount), 0)
    .toFixed(2);
}

function styleTableCell(cell: ExcelJS.Cell) {
  cell.border = BORDER;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function styleTextCell(cell: ExcelJS.Cell) {
  styleTableCell(cell);
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
}

export async function buildContributionWorkbookFromData({
  sections,
  year = new Date().getFullYear(),
}: BuildContributionWorkbookInput) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LateWatch';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet(`${year} CONTRIBUTIONS`);
  worksheet.properties.defaultRowHeight = 22;
  worksheet.columns = [
    { key: 'number', width: 8 },
    { key: 'name', width: 34 },
    { key: 'amount', width: 16 },
    { key: 'note', width: 24 },
  ];

  let sectionTitleRow = 2;

  sections.forEach((section) => {
    const titleCell = worksheet.getCell(sectionTitleRow, 2);
    titleCell.value = section.title;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.mergeCells(sectionTitleRow, 2, sectionTitleRow, 4);

    const headerRowNumber = sectionTitleRow + 2;
    const headerRow = worksheet.getRow(headerRowNumber);
    headerRow.values = ['No.', 'Name', 'Amount', 'Note'];
    headerRow.eachCell((cell) => {
      styleTableCell(cell);
      cell.font = { bold: true };
      cell.fill = {
        fgColor: { argb: 'FFEAF2FF' },
        pattern: 'solid',
        type: 'pattern',
      };
    });

    const entryStartRow = headerRowNumber + 2;
    section.entries.forEach((entry, index) => {
      const row = worksheet.getRow(entryStartRow + index);
      row.getCell(1).value = index + 1;
      row.getCell(2).value = entry.contributorName;
      row.getCell(3).value = amountNumber(entry.amount);
      row.getCell(4).value = entry.note || null;
      styleTableCell(row.getCell(1));
      styleTextCell(row.getCell(2));
      styleTableCell(row.getCell(3));
      styleTextCell(row.getCell(4));
      row.getCell(3).numFmt = '#,##0.00';
    });

    const totalRowNumber = entryStartRow + section.entries.length + 1;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(2).value = 'TOTAL';
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(3).value = {
      formula: `SUM(C${entryStartRow}:C${entryStartRow + Math.max(section.entries.length - 1, 0)})`,
    };
    totalRow.getCell(3).numFmt = '#,##0.00';
    styleTableCell(totalRow.getCell(2));
    styleTableCell(totalRow.getCell(3));

    sectionTitleRow = totalRowNumber + 4;
  });

  return workbook;
}

export async function buildContributionExportWorkbook() {
  const { getContributionSections } = await import('@/lib/contributions');
  const sections = await getContributionSections();
  const year = new Date().getFullYear();
  const workbook = await buildContributionWorkbookFromData({ sections, year });
  const buffer = await workbook.xlsx.writeBuffer();
  const entryCount = sections.reduce((total, section) => total + section.entries.length, 0);
  const totalAmount = contributionTotal(sections.flatMap((section) => section.entries));

  return {
    buffer,
    entryCount,
    fileName: `Contributions_${format(new Date(year, 0, 1), 'yyyy')}.xlsx`,
    sectionCount: sections.length,
    totalAmount,
  };
}
