// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend, startOfMonth, endOfMonth, addDays, eachDayOfInterval } from 'date-fns';
import { buildWeeklyWorkbook } from '@/app/api/export/weekly/route';

/**
 * Copy all cells, values, styles, numFmt, and merges from src to dst sheet.
 */
function copySheet(src: ExcelJS.Worksheet, dst: ExcelJS.Worksheet) {
  // Copy column widths from model
  const srcModel = src.model as unknown as Record<string, unknown> | undefined;
  if (srcModel?.cols) {
    for (const col of srcModel.cols as Array<{ min: number; width?: number }>) {
      const idx = col.min;
      if (col.width) dst.getColumn(idx).width = col.width;
    }
  }

  // Copy each row and cell
  src.eachRow((row, rowNum) => {
    const dstRow = dst.getRow(rowNum);
    dstRow.height = row.height;
    row.eachCell((cell, colNum) => {
      const dstCell = dstRow.getCell(colNum);
      dstCell.value = cell.value;
      if (cell.numFmt) dstCell.numFmt = cell.numFmt;
      if (cell.style) dstCell.style = { ...cell.style };
    });
  });

  // Copy merges
  const merges = srcModel?.merges as string[] | undefined;
  for (const merge of merges || []) {
    try { dst.mergeCells(merge); } catch { /* skip bad merges */ }
  }
}

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

    const monthlyBook = new ExcelJS.Workbook();
    monthlyBook.creator = 'LateWatch';
    monthlyBook.created = new Date();

    for (let w = 0; w < weekKeys.length; w++) {
      const weekStart = weekKeys[w];
      const weekEnd = format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd');

      const weeklyBook = await buildWeeklyWorkbook(weekStart, weekEnd, actorUserId, actorEmail);
      const srcSheet = weeklyBook.worksheets[0];
      if (!srcSheet) continue;

      const newSheet = monthlyBook.addWorksheet(`Week ${w + 1}`);
      copySheet(srcSheet, newSheet);
    }

    const buffer = await monthlyBook.xlsx.writeBuffer();

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