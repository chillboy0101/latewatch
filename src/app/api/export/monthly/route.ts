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

    // Get all weekdays in the month
    const allMonthDays = eachDayOfInterval({ start: monthStartDate, end: monthEnd })
      .filter(d => !isWeekend(d));

    if (allMonthDays.length === 0) {
      return NextResponse.json({ error: 'No weekdays in this month' }, { status: 400 });
    }

    // Group days by their Monday-starting week
    const daysByWeek: Record<string, typeof allMonthDays> = {};
    for (const day of allMonthDays) {
      let monday = new Date(day);
      while (monday.getDay() !== 1) monday = addDays(monday, -1);
      const key = format(monday, 'yyyy-MM-dd');
      if (!daysByWeek[key]) daysByWeek[key] = [];
      daysByWeek[key].push(day);
    }

    const weekKeys = Object.keys(daysByWeek).sort();

    // Build monthly workbook
    const monthlyBook = new ExcelJS.Workbook();
    monthlyBook.creator = 'LateWatch';
    monthlyBook.created = new Date();

    for (let w = 0; w < weekKeys.length; w++) {
      const weekStart = weekKeys[w];
      const weekEnd = format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd');

      // Build weekly workbook (reuses weekly export logic)
      const weeklyBook = await buildWeeklyWorkbook(weekStart, weekEnd, actorUserId, actorEmail);
      const weekBuf = await weeklyBook.xlsx.writeBuffer();

      // Load into temp book to clone the sheet model
      const tmpBook = new ExcelJS.Workbook();
      await tmpBook.xlsx.load(weekBuf as any);

      const srcSheet = tmpBook.worksheets[0];
      if (!srcSheet) continue;

      const newSheet = monthlyBook.addWorksheet(`Week ${w + 1}`);
      newSheet.model = JSON.parse(JSON.stringify(srcSheet.model));
      newSheet.state = srcSheet.state;
    }

    const buffer = await monthlyBook.xlsx.writeBuffer();

    // Audit log
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