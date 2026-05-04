// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, staff } from '@/db/schema';
import { and, gte, lte, eq, asc, sql, or, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { format, parseISO } from 'date-fns';
import path from 'path';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { getMonthWorkingWeeks } from '@/lib/export-weeks';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';

// ── Staff order: fetched from DB ordered by displayOrder then fullName ──

// Day block layout (1-based row indices from template)
// Index 0=Monday block, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday
const DAY_DATA_START = [4, 22, 40, 58, 76];
const BASE_STAFF_ROWS_PER_BLOCK = 15;
const BASE_TOTAL_START = 95;
const DAY_HEADER_VALUES = ['NAME', 'TIME', 'AMOUNT', 'REASON'];
const DATE_SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC0C0C0' },
};

type WorksheetLayout = {
  dataStart: number[];
  headerRow: number[];
  rowsPerBlock: number;
  titleRow: number[];
  totalLabelRow: number;
  totalStart: number;
};

function getOrdinalSuffix(n: number): string {
  if (n > 3 && n < 21) return 'TH';
  switch (n % 10) { case 1: return 'ST'; case 2: return 'ND'; case 3: return 'RD'; default: return 'TH'; }
}

/**
 * Returns which template slot (0-4, Mon-Fri) a given date maps to.
 * Returns -1 if the date is a weekend.
 */
function dayToSlot(d: Date): number {
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (dow === 0 || dow === 6) return -1; // weekend
  return dow - 1; // Mon(1)→0, Tue(2)→1, Wed(3)→2, Thu(4)→3, Fri(5)→4
}

function resolveWeekNumber(weekStart: string, weekEnd: string, explicitWeekNumber?: number) {
  if (typeof explicitWeekNumber === 'number' && Number.isInteger(explicitWeekNumber) && explicitWeekNumber >= 1) {
    return explicitWeekNumber;
  }

  const exportStart = parseISO(weekStart);
  const weeks = getMonthWorkingWeeks(exportStart.getFullYear(), exportStart.getMonth());
  const matchingWeek = weeks.find((week) =>
    week.weekStart === weekStart ||
    week.exportStart === weekStart ||
    (week.exportStart <= weekEnd && week.exportEnd >= weekStart)
  );

  if (matchingWeek) return matchingWeek.weekNumber;

  return Math.max(1, Math.floor((exportStart.getDate() - 1) / 7) + 1);
}

function cloneStyle(style: Partial<ExcelJS.Style>) {
  return JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>;
}

function getWorksheetLayout(rowsPerBlock: number): WorksheetLayout {
  const blockHeight = 3 + rowsPerBlock;
  const titleRow = Array.from({ length: 5 }, (_, slot) => 1 + slot * blockHeight);
  const headerRow = titleRow.map((row) => row + 2);
  const dataStart = titleRow.map((row) => row + 3);
  const totalStart = BASE_TOTAL_START + (rowsPerBlock - BASE_STAFF_ROWS_PER_BLOCK) * 5;

  return {
    dataStart,
    headerRow,
    rowsPerBlock,
    titleRow,
    totalLabelRow: totalStart + rowsPerBlock,
    totalStart,
  };
}

function prepareWorksheetLayout(worksheet: ExcelJS.Worksheet, staffRowCount: number): WorksheetLayout {
  const rowsPerBlock = Math.max(BASE_STAFF_ROWS_PER_BLOCK, staffRowCount);
  const layout = getWorksheetLayout(rowsPerBlock);
  const extraRows = rowsPerBlock - BASE_STAFF_ROWS_PER_BLOCK;

  if (extraRows <= 0) return layout;

  const titleStyles = [1, 2].map((offset) =>
    Array.from({ length: 5 }, (_, index) => cloneStyle(worksheet.getCell(1 + offset - 1, index + 1).style))
  );
  const headerStyles = Array.from({ length: 5 }, (_, index) => cloneStyle(worksheet.getCell(3, index + 1).style));
  const dataStyles = Array.from({ length: 5 }, (_, index) => cloneStyle(worksheet.getCell(4, index + 1).style));
  const totalStyles = Array.from({ length: 2 }, (_, index) => cloneStyle(worksheet.getCell(BASE_TOTAL_START, index + 1).style));
  const totalLabelStyles = Array.from({ length: 2 }, (_, index) => cloneStyle(worksheet.getCell(BASE_TOTAL_START + BASE_STAFF_ROWS_PER_BLOCK, index + 1).style));
  const dataRowHeight = worksheet.getRow(4).height;
  const titleRowHeights = [worksheet.getRow(1).height, worksheet.getRow(2).height];
  const headerRowHeight = worksheet.getRow(3).height;
  const totalRowHeight = worksheet.getRow(BASE_TOTAL_START).height;
  const totalLabelRowHeight = worksheet.getRow(BASE_TOTAL_START + BASE_STAFF_ROWS_PER_BLOCK).height;
  const templateMerges = [...(((worksheet.model as unknown as { merges?: string[] }).merges) || [])];

  for (const merge of templateMerges) {
    try { worksheet.unMergeCells(merge); } catch { /* ignore stale template merges */ }
  }

  for (let slot = 4; slot >= 0; slot--) {
    const insertAt = DAY_DATA_START[slot] + BASE_STAFF_ROWS_PER_BLOCK;
    worksheet.spliceRows(insertAt, 0, ...Array.from({ length: extraRows }, () => []));
  }

  const totalLabelRowBeforeExpansion = BASE_TOTAL_START + BASE_STAFF_ROWS_PER_BLOCK + extraRows * 5;
  worksheet.spliceRows(totalLabelRowBeforeExpansion, 0, ...Array.from({ length: extraRows }, () => []));

  for (let slot = 0; slot < 5; slot++) {
    const title = layout.titleRow[slot];
    const header = layout.headerRow[slot];
    const dataStart = layout.dataStart[slot];

    for (let rowOffset = 0; rowOffset < 2; rowOffset++) {
      const row = worksheet.getRow(title + rowOffset);
      row.height = titleRowHeights[rowOffset];
      for (let col = 1; col <= 5; col++) {
        worksheet.getCell(title + rowOffset, col).style = cloneStyle(titleStyles[rowOffset][col - 1]);
      }
    }

    worksheet.getRow(header).height = headerRowHeight;
    for (let col = 1; col <= 5; col++) {
      worksheet.getCell(header, col).style = cloneStyle(headerStyles[col - 1]);
    }

    for (let staffIdx = 0; staffIdx < rowsPerBlock; staffIdx++) {
      const row = dataStart + staffIdx;
      worksheet.getRow(row).height = dataRowHeight;
      for (let col = 1; col <= 5; col++) {
        worksheet.getCell(row, col).style = cloneStyle(dataStyles[col - 1]);
      }
    }

    worksheet.mergeCells(title, 1, title + 1, 5);
    worksheet.mergeCells(header, 5, dataStart + rowsPerBlock - 1, 5);
  }

  for (let staffIdx = 0; staffIdx < rowsPerBlock; staffIdx++) {
    const row = layout.totalStart + staffIdx;
    worksheet.getRow(row).height = totalRowHeight;
    for (let col = 1; col <= 2; col++) {
      worksheet.getCell(row, col).style = cloneStyle(totalStyles[col - 1]);
    }
  }

  worksheet.getRow(layout.totalLabelRow).height = totalLabelRowHeight;
  for (let col = 1; col <= 2; col++) {
    worksheet.getCell(layout.totalLabelRow, col).style = cloneStyle(totalLabelStyles[col - 1]);
  }

  return layout;
}

function applyDateSectionStyle(worksheet: ExcelJS.Worksheet, titleRow: number) {
  for (let row = titleRow; row <= titleRow + 1; row++) {
    for (let col = 1; col <= 5; col++) {
      const cell = worksheet.getCell(row, col);
      cell.fill = DATE_SECTION_FILL;
      cell.font = {
        ...cell.font,
        bold: true,
        color: { argb: 'FF000000' },
      };
    }
  }
}

/**
 * Build a weekly workbook for the given Mon-Fri date range.
 * Returns a workbook with one sheet matching the lateness-book template,
 * populated with the week's data.
 */
export async function buildWeeklyWorkbook(
  weekStart: string,
  weekEnd: string,
  actorUserId?: string | null,
  actorEmail?: string,
  actualMonthStart?: string,
  actualMonthEnd?: string,
  weekNumber?: number,
): Promise<ExcelJS.Workbook> {
  const templatePath = path.join(process.cwd(), 'src', 'lateness-book.xlsx');

  await syncLatenessEntriesFromAttendanceForRange(weekStart, weekEnd);

  // Fetch entries for the week
  const entries = await db.select({
    staffId: latenessEntry.staffId,
    date: latenessEntry.date,
    arrivalTime: latenessEntry.arrivalTime,
    computedAmount: latenessEntry.computedAmount,
    reason: latenessEntry.reason,
  })
  .from(latenessEntry)
  .where(and(gte(latenessEntry.date, weekStart), lte(latenessEntry.date, weekEnd)));

  const entryStaffIds = Array.from(new Set(entries.map((entry) => entry.staffId).filter(Boolean)));
  const currentRosterCondition = and(eq(staff.active, true), eq(staff.archived, false));
  const exportRosterCondition = entryStaffIds.length > 0
    ? or(currentRosterCondition, inArray(staff.id, entryStaffIds))
    : currentRosterCondition;

  // Use the current active roster, plus historical staff who have entries in this export range.
  const allStaffRows = await db.select({ id: staff.id, fullName: staff.fullName })
    .from(staff)
    .where(exportRosterCondition)
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

  const orderedStaff = allStaffRows;

  // Fetch holidays for the week
  const holidays = await db.select({ date: workCalendar.date })
    .from(workCalendar)
    .where(and(gte(workCalendar.date, weekStart), lte(workCalendar.date, weekEnd), eq(workCalendar.isHoliday, true)));

  const holidaySet = new Set(holidays.map(h => h.date));
  const entryByStaffDate: Record<string, typeof entries[0]> = {};
  for (const e of entries) {
    entryByStaffDate[`${e.staffId}:${e.date}`] = e;
  }

  // Load template
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const worksheet = workbook.getWorksheet('TEMPLATE') || workbook.getWorksheet('WEEK 4') || workbook.getWorksheet('WEEK 1');
  if (!worksheet) throw new Error('Template sheet not found');
  const layout = prepareWorksheetLayout(worksheet, orderedStaff.length);
  worksheet.name = `WEEK ${resolveWeekNumber(weekStart, weekEnd, weekNumber)}`;

  // Determine the actual valid days for this week within the month range
  // (respects month boundaries and excludes weekends)
  const startDate = parseISO(weekStart);
  const endDate = parseISO(weekEnd);

  // Build list of valid (non-weekend) dates for this week
  const validDays: { date: Date; dateStr: string; slot: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + 86400000)) {
    const weekdaySlot = dayToSlot(d);
    if (weekdaySlot === -1) continue; // skip weekend
    // Respect actual month boundaries (used by monthly export)
    if (actualMonthStart && d < parseISO(actualMonthStart)) continue;
    if (actualMonthEnd && d > parseISO(actualMonthEnd)) continue;
    if (validDays.length >= layout.dataStart.length) break;
    validDays.push({
      date: new Date(d),
      dateStr: format(d, 'yyyy-MM-dd'),
      slot: validDays.length,
    });
  }

  // Clear all cells (NAME col A, TIME col B, AMOUNT col C, REASON col D, HOLIDAY col E) for all 5 blocks first
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    const dataStart = layout.dataStart[dayIdx];
    for (let staffIdx = 0; staffIdx < layout.rowsPerBlock; staffIdx++) {
      const row = dataStart + staffIdx;
      worksheet.getCell(row, 1).value = undefined; // NAME
      worksheet.getCell(row, 2).value = undefined; // TIME
      worksheet.getCell(row, 3).value = undefined; // AMOUNT
      worksheet.getCell(row, 4).value = undefined; // REASON
    }
    worksheet.getCell(layout.headerRow[dayIdx], 5).value = undefined;
  }

  // Also clear unused template rows beyond our staff count (leave template NAME cells empty)
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    const dataStart = layout.dataStart[dayIdx];
    for (let staffIdx = orderedStaff.length; staffIdx < layout.rowsPerBlock; staffIdx++) {
      const row = dataStart + staffIdx;
      worksheet.getCell(row, 1).value = undefined;
      worksheet.getCell(row, 2).value = undefined;
      worksheet.getCell(row, 3).value = undefined;
      worksheet.getCell(row, 4).value = undefined;
    }
    // Clear TOTAL section unused rows
    const totalStart = layout.totalStart;
    for (let staffIdx = orderedStaff.length; staffIdx < layout.rowsPerBlock; staffIdx++) {
      const row = totalStart + staffIdx;
      worksheet.getCell(row, 1).value = undefined;
      worksheet.getCell(row, 2).value = undefined;
    }
  }

  // Clear all TITLE and HEADER rows first (reset to empty)
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    for (let col = 1; col <= 5; col++) {
      worksheet.getCell(layout.titleRow[dayIdx], col).value = undefined;
    }
    for (let col = 1; col <= 4; col++) {
      worksheet.getCell(layout.headerRow[dayIdx], col).value = undefined;
    }
    worksheet.getCell(layout.headerRow[dayIdx], 5).value = undefined;
  }

  // Keep partial month weeks compact: show only included dates and hide the unused template blocks.
  const visibleSlots = new Set(validDays.map((day) => day.slot));
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    const shouldHideBlock = !visibleSlots.has(dayIdx);
    const firstRow = layout.titleRow[dayIdx];
    const lastRow = layout.dataStart[dayIdx] + layout.rowsPerBlock - 1;
    for (let row = firstRow; row <= lastRow; row++) {
      worksheet.getRow(row).hidden = shouldHideBlock;
    }
  }

  // Write the day/date title and column headers for every included export day.
  for (const day of validDays) {
    const dayName = format(day.date, 'EEEE').toUpperCase();
    const dayNum = day.date.getDate();
    const monthYear = format(day.date, 'MMMM yyyy').toUpperCase();
    const titleText = `${dayName}, ${dayNum}${getOrdinalSuffix(dayNum)} ${monthYear}`;
    const titleCell = worksheet.getCell(layout.titleRow[day.slot], 1);
    titleCell.value = titleText;
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    applyDateSectionStyle(worksheet, layout.titleRow[day.slot]);

    for (let idx = 0; idx < DAY_HEADER_VALUES.length; idx++) {
      const headerCell = worksheet.getCell(layout.headerRow[day.slot], idx + 1);
      headerCell.value = DAY_HEADER_VALUES[idx];
      headerCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  // Fill TIME (col B), AMOUNT (col C), REASON (col D) for each valid day
  for (const day of validDays) {
    const { dateStr, slot } = day;
    const dataStart = layout.dataStart[slot];
    const headerRow = layout.headerRow[slot];

    const isWeekdayHoliday = holidaySet.has(dateStr);
    if (isWeekdayHoliday) {
      const holidayCell = worksheet.getCell(headerRow, 5);
      holidayCell.value = 'HOLIDAY';
      holidayCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    for (let staffIdx = 0; staffIdx < orderedStaff.length; staffIdx++) {
      const row = dataStart + staffIdx;
      const staffId = orderedStaff[staffIdx].id;
      const entry = staffId ? entryByStaffDate[`${staffId}:${dateStr}`] : null;
      const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;

      // TIME (col 2)
      const timeCell = worksheet.getCell(row, 2);
      if (entry?.arrivalTime) {
        const [hours, minutes] = entry.arrivalTime.split(':').map(Number);
        timeCell.value = new Date(2000, 0, 1, hours, minutes);
        timeCell.numFmt = 'h:mm AM/PM';
      } else {
        timeCell.value = undefined;
      }

      // AMOUNT (col 3)
      const amountCell = worksheet.getCell(row, 3);
      if (amount > 0) {
        amountCell.value = amount;
        amountCell.numFmt = '"GHC "#,##0.00';
      }

      // REASON (col 4)
      worksheet.getCell(row, 4).value = entry?.reason || undefined;
    }
  }

  // Write staff names into the NAME column (col A) for included day blocks only.
  for (const day of validDays) {
    const dataStart = layout.dataStart[day.slot];
    for (let staffIdx = 0; staffIdx < orderedStaff.length; staffIdx++) {
      const row = dataStart + staffIdx;
      worksheet.getCell(row, 1).value = orderedStaff[staffIdx].fullName;
    }
  }

  // Write staff names into TOTAL section and set formulas
  const totalStart = layout.totalStart;
  for (let staffIdx = 0; staffIdx < orderedStaff.length; staffIdx++) {
    const row = totalStart + staffIdx;
    const name = orderedStaff[staffIdx].fullName;
    worksheet.getCell(row, 1).value = name;
    const cRefs = validDays.map((day) => {
      const r = layout.dataStart[day.slot] + staffIdx;
      return `C${r}`;
    }).join(',');
    worksheet.getCell(row, 2).value = cRefs ? { formula: `SUM(${cRefs})` } : 0;
    worksheet.getCell(row, 2).numFmt = '"GHC "#,##0.00';
  }

  worksheet.getCell(layout.totalLabelRow, 1).value = 'TOTAL:';
  worksheet.getCell(layout.totalLabelRow, 2).value = {
    formula: orderedStaff.length > 0
      ? `SUM(B${totalStart}:B${totalStart + orderedStaff.length - 1})`
      : '0',
  };

  // Set GHC currency format on TOTAL column B
  for (let r = totalStart; r <= layout.totalLabelRow; r++) {
    worksheet.getCell(r, 2).numFmt = '"GHC "#,##0.00';
  }

  return workbook;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { weekStart, weekEnd, weekNumber } = body;

    if (!weekStart || !weekEnd) {
      return NextResponse.json({ error: 'Week start and end required' }, { status: 400 });
    }

    const actor = await getAuditActor();

    const workbook = await buildWeeklyWorkbook(
      weekStart,
      weekEnd,
      actor.actorUserId,
      actor.actorEmail,
      undefined,
      undefined,
      Number(weekNumber),
    );
    const buffer = await workbook.xlsx.writeBuffer();

    // Audit log (non-blocking)
    try {
      const [{ count }] = await db.select({ count: sql`count(*)::int` })
        .from(staff)
        .where(and(eq(staff.active, true), eq(staff.archived, false)));
      await tryWriteAuditEvent({
        entityType: 'export',
        entityId: `weekly-${weekStart}-${weekEnd}`,
        action: 'GENERATE',
        before: null,
        after: { weekStart, weekEnd, staffCount: count },
        actor: { id: actor.actorUserId, email: actor.actorEmail },
        reason: 'exports',
      });
    } catch (auditError) {
      console.error('Audit log failed (export still succeeded):', auditError);
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Lateness_${weekStart}_${weekEnd}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Export failed: ${errMsg}` }, { status: 500 });
  }
}
