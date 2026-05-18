// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { buildWeeklyWorkbook } from '@/app/api/export/weekly/route';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { getMonthWorkingWeeks, type WorkingWeekRange } from '@/lib/export-weeks';

function sheetNameForWeek(week: WorkingWeekRange) {
  const startLabel = format(parseISO(week.exportStart), 'dd MMM');
  const endLabel = format(parseISO(week.exportEnd), 'dd MMM');
  return `Week ${week.weekNumber} ${startLabel}-${endLabel}`
    .replace(/[\\/*?:[\]]/g, '')
    .slice(0, 31);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month } = body;

    const exportYear = Number(year);
    const exportMonth = Number(month);

    if (!Number.isInteger(exportYear) || !Number.isInteger(exportMonth) || exportMonth < 0 || exportMonth > 11) {
      return NextResponse.json({ error: 'Year and month required' }, { status: 400 });
    }

    const actor = await getAuditActor();

    const monthStartDate = startOfMonth(new Date(exportYear, exportMonth, 1));
    const monthEnd = endOfMonth(monthStartDate);
    const workingWeeks = getMonthWorkingWeeks(exportYear, exportMonth);

    // Create a temporary workbook that will hold all week sheets
    // We build each week, write to buffer, then load that buffer and add its sheet
    const combinedBook = new ExcelJS.Workbook();
    combinedBook.creator = 'LateWatch';
    combinedBook.created = new Date();

    for (const week of workingWeeks) {
      const weeklyBook = await buildWeeklyWorkbook(
        week.weekStart,
        week.weekEnd,
        actor.actorUserId,
        actor.actorEmail,
        format(monthStartDate, 'yyyy-MM-dd'),
        format(monthEnd, 'yyyy-MM-dd'),
        week.weekNumber,
      );
      const weekBuf = await weeklyBook.xlsx.writeBuffer();

      // Load weekly book from buffer
      const tmpBook = new ExcelJS.Workbook();
      await tmpBook.xlsx.load(weekBuf);

      const srcSheet = tmpBook.worksheets[0];
      if (!srcSheet) continue;

      // Copy cells directly from srcSheet to new sheet in combinedBook
      const newSheet = combinedBook.addWorksheet(sheetNameForWeek(week));

      // Copy column widths
      const srcModel = srcSheet.model as unknown as Record<string, unknown>;
      if (srcModel?.cols) {
        for (const col of srcModel.cols as Array<{ min: number; width?: number }>) {
          if (col.width) newSheet.getColumn(col.min).width = col.width;
        }
      }

      // Copy each row by iterating model rows (eachRow skips cells with null values)
      const modelRows = (srcModel.rows as Array<Record<string, unknown>> | undefined) || [];
      for (const modelRow of modelRows) {
        const rowNum = modelRow.number as number;
        const newRow = newSheet.getRow(rowNum);
        const rowHidden = modelRow.hidden as boolean | undefined;
        const rowHeight = modelRow.height as number | undefined;
        if (typeof rowHidden === 'boolean') newRow.hidden = rowHidden;
        if (typeof rowHeight === 'number') newRow.height = rowHeight;
        const cells = modelRow.cells as Array<Record<string, unknown>> | undefined;
        if (cells) {
          for (const cell of cells) {
            const addr = cell.address as string;
            const colLetter = addr.replace(/[0-9]/g, '');
            const colNum = colLetter.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
            const newCell = newRow.getCell(colNum);
            // Always set value so the cell is created in the sheet (even if undefined)
            newCell.value = cell.value as ExcelJS.CellValue;
            // Copy formula if present (for formula cells like TOTAL section)
            const cellAny = cell as unknown as Record<string, unknown>;
            if (cellAny.formula) {
              // Preserve cached results so Excel displays totals before recalculating.
              const formulaValue: ExcelJS.CellFormulaValue = {
                formula: String(cellAny.formula),
              };
              if ('result' in cellAny) {
                formulaValue.result = cellAny.result as ExcelJS.CellFormulaValue['result'];
              }
              newCell.value = formulaValue;
            } else {
              newCell.value = cell.value as ExcelJS.CellValue;
            }
            const style = cell.style as Record<string, unknown> | undefined;
            if (style) newCell.style = style as unknown as ExcelJS.Style;
            const numFmt = cell.numFmt as string | undefined;
            if (numFmt) newCell.numFmt = numFmt;
          }
        }
      }

      // Copy merges
      const merges = srcModel.merges as string[] | undefined;
      if (merges) {
        for (const merge of merges) {
          try { newSheet.mergeCells(merge); } catch { /* skip */ }
        }
      }
    }

    combinedBook.calcProperties.fullCalcOnLoad = true;
    const buffer = await combinedBook.xlsx.writeBuffer();

    try {
      await tryWriteAuditEvent({
        entityType: 'export',
        entityId: `monthly-${exportYear}-${exportMonth + 1}`,
        action: 'GENERATE',
        before: null,
        after: {
          year: exportYear,
          month: exportMonth + 1,
          weekCount: workingWeeks.length,
          weeks: workingWeeks.map((week) => ({
            weekNumber: week.weekNumber,
            exportStart: week.exportStart,
            exportEnd: week.exportEnd,
            dates: week.dates,
          })),
        },
        actor: { id: actor.actorUserId, email: actor.actorEmail },
        reason: 'exports',
      });
    } catch (auditError) {
      console.error('Audit log failed:', auditError);
    }

    const monthName = format(monthStartDate, 'MMMM_yyyy');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${monthName}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Monthly export failed:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Monthly export failed: ${errMsg}` }, { status: 500 });
  }
}
