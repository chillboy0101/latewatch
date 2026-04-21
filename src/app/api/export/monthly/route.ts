// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend, startOfMonth, endOfMonth, addDays, eachDayOfInterval } from 'date-fns';
import { buildWeeklyWorkbook } from '@/app/api/export/weekly/route';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month } = body;

    if (year === undefined || month === undefined) {
      return NextResponse.json({ error: 'Year and month required' }, { status: 400 });
    }

    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

    const monthStartDate = startOfMonth(new Date(year, month));
    const monthEnd = endOfMonth(new Date(year, month));

    const allMonthDays = eachDayOfInterval({ start: monthStartDate, end: monthEnd })
      .filter(d => !isWeekend(d));

    if (allMonthDays.length === 0) {
      return NextResponse.json({ error: 'No weekdays in this month' }, { status: 400 });
    }

    const daysByWeek: Record<string, typeof allMonthDays> = {};
    for (const day of allMonthDays) {
      let monday = new Date(day);
      while (monday.getDay() !== 1) monday = addDays(monday, -1);
      const key = format(monday, 'yyyy-MM-dd');
      if (!daysByWeek[key]) daysByWeek[key] = [];
      daysByWeek[key].push(day);
    }

    const weekKeys = Object.keys(daysByWeek).sort();

    // Create a temporary workbook that will hold all week sheets
    // We build each week, write to buffer, then load that buffer and add its sheet
    const combinedBook = new ExcelJS.Workbook();
    combinedBook.creator = 'LateWatch';
    combinedBook.created = new Date();

    for (let w = 0; w < weekKeys.length; w++) {
      const weekStart = weekKeys[w];
      const weekEnd = format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd');

      // Build weekly workbook, passing month end to respect boundaries
      const weeklyBook = await buildWeeklyWorkbook(weekStart, weekEnd, actorUserId, actorEmail, format(monthEnd, 'yyyy-MM-dd'));
      const weekBuf = await weeklyBook.xlsx.writeBuffer();

      // Load weekly book from buffer
      const tmpBook = new ExcelJS.Workbook();
      await tmpBook.xlsx.load(weekBuf as any);

      const srcSheet = tmpBook.worksheets[0];
      if (!srcSheet) continue;

      // Copy cells directly from srcSheet to new sheet in combinedBook
      const newSheet = combinedBook.addWorksheet(`Week ${w + 1}`);

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
              // For formula cells: value must be set as { formula: '...' } to preserve the formula
              (newCell as unknown as Record<string, unknown>).value = { formula: cellAny.formula };
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

    const buffer = await combinedBook.xlsx.writeBuffer();

    try {
      await db.insert(auditEvent).values({
        entityType: 'export',
        entityId: `monthly-${year}-${month + 1}`,
        action: 'EXPORT',
        beforeJson: null,
        afterJson: { year, month: month + 1, weekCount: weekKeys.length },
        actorUserId,
        actorEmail,
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