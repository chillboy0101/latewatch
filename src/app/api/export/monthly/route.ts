// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend, startOfMonth, endOfMonth, addDays, eachDayOfInterval, getDay } from 'date-fns';
import path from 'path';

function getOrdinalSuffix(n: number): string {
  if (n > 3 && n < 21) return 'TH';
  switch (n % 10) { case 1: return 'ST'; case 2: return 'ND'; case 3: return 'RD'; default: return 'TH'; }
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

    // Fixed staff order matching the LATENESS BOOK template
    const STAFF_ORDER = [
      'CHARLES DODGATSE',
      'EYRAM MENSAH-GBAGBO',
      'ANNA-LISA E. A. HAMMOND',
      'CLAUDE KWASI BOADI',
      'EUNICE TWENEBOAA ADU',
      'ESTHER ADJOKOR ADJEI',
      'RAPHAELADJEI MENSAH',
      'DENNIS AKUETTEH ARYEETEY',
      'DANIEL ASARE KWARTENG',
      'WISDOM KOFI DATSOMOR',
      'CARL CHRISTIAN QUIST',
      'LISABETH SYBIL ADDAIH',
      'ELEAZAR KWABENA TJ',
      'REGINA ALLOTEY',
      'EMMANUEL CHUKWUDI',
    ];

    // Day block layout (1-based row indices from template)
    const DAY_DATA_START = [4, 22, 40, 58, 76];
    const DAY_HEADER_ROW  = [3, 21, 39, 57, 75];
    const DAY_TITLE_ROW   = [1, 19, 37, 55, 73];

    const monthStartDate = startOfMonth(new Date(year, month));
    const monthEnd = endOfMonth(new Date(year, month));

    // Get ALL weekdays (Mon-Fri) in the month
    const allMonthDays = eachDayOfInterval({ start: monthStartDate, end: monthEnd })
      .filter(d => !isWeekend(d));

    if (allMonthDays.length === 0) {
      return NextResponse.json({ error: 'No weekdays in this month' }, { status: 400 });
    }

    // Group month days by their week (week starting Monday)
    // Key: "YYYY-MM-DD" of the Monday of that week
    const daysByWeek: Record<string, Date[]> = {};
    for (const day of allMonthDays) {
      // Find Monday of this week
      let monday = new Date(day);
      while (monday.getDay() !== 1) monday = addDays(monday, -1);
      const key = format(monday, 'yyyy-MM-dd');
      if (!daysByWeek[key]) daysByWeek[key] = [];
      daysByWeek[key].push(day);
    }

    // Sort weeks
    const weekKeys = Object.keys(daysByWeek).sort();
    const weeks = weekKeys.map(key => ({
      monday: parseISO(key),
      days: daysByWeek[key], // already sorted
    }));

    const allStaffRows = await db.select({ id: staff.id, fullName: staff.fullName })
      .from(staff)
      .where(eq(staff.active, true));
    const staffNameToId: Record<string, string> = {};
    for (const s of allStaffRows) staffNameToId[s.fullName] = s.id;
    const orderedStaff = STAFF_ORDER.map(name => ({ name, id: staffNameToId[name] || null }));

    const templatePath = path.join(process.cwd(), 'src', 'lateness-book.xlsx');

    // Single workbook — one sheet per week
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LateWatch';
    workbook.created = new Date();

    for (let w = 0; w < weeks.length; w++) {
      const { monday, days: monthDays } = weeks[w];

      // Load template fresh for each week
      const weekBook = new ExcelJS.Workbook();
      await weekBook.xlsx.readFile(templatePath);
      const ws = weekBook.getWorksheet('WEEK 4') || weekBook.getWorksheet('WEEK 1');
      if (!ws) continue;

      const sheetName = `WEEK ${w + 1} - ${format(monthDays[0], 'MMM dd')}`;
      ws.name = sheetName;

      // Build lookup maps for this week
      const weekStartStr = format(monday, 'yyyy-MM-dd');
      const weekEndStr = format(addDays(monday, 4), 'yyyy-MM-dd');

      const entries = await db.select({
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        computedAmount: latenessEntry.computedAmount,
        reason: latenessEntry.reason,
      })
      .from(latenessEntry)
      .where(and(gte(latenessEntry.date, weekStartStr), lte(latenessEntry.date, weekEndStr)));

      const holidays = await db.select({ date: workCalendar.date })
        .from(workCalendar)
        .where(and(gte(workCalendar.date, weekStartStr), lte(workCalendar.date, weekEndStr), eq(workCalendar.isHoliday, true)));

      const holidaySet = new Set(holidays.map(h => h.date));
      const entryByStaff: Record<string, typeof entries[0]> = {};
      for (const e of entries) entryByStaff[e.staffId] = e;

      // Map month day → DAY_INDEX (0=Mon, 1=Tue, ..., 4=Fri)
      // to know which template slot to fill
      const monthDayToDayIdx: Record<string, number> = {};
      for (const d of monthDays) monthDayToDayIdx[format(d, 'yyyy-MM-dd')] = getDay(d) - 1;

      // Clear the data cells and header rows for all 5 day slots
      for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
        const dataStart = DAY_DATA_START[dayIdx];
        for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
          const row = dataStart + staffIdx;
          ws.getCell(row, 2).value = undefined; // TIME
          ws.getCell(row, 3).value = undefined; // AMOUNT
          ws.getCell(row, 4).value = undefined; // REASON
        }
        // Clear title and holiday for this slot too
        ws.getCell(DAY_TITLE_ROW[dayIdx], 1).value = undefined;
        ws.getCell(DAY_HEADER_ROW[dayIdx], 5).value = undefined;
      }

      // Fill the day slots that are in this month
      for (const dayDate of monthDays) {
        const dayIdx = getDay(dayDate) - 1; // 0=Mon, 1=Tue, ..., 4=Fri
        const dateStr = format(dayDate, 'yyyy-MM-dd');
        const dataStart = DAY_DATA_START[dayIdx];
        const headerRow = DAY_HEADER_ROW[dayIdx];

        // Date title: "MONDAY,1ST APRIL 2026"
        const dayName = format(dayDate, 'EEEE').toUpperCase();
        const dayNum = dayDate.getDate();
        const monthYear = format(dayDate, 'MMMM yyyy').toUpperCase();
        ws.getCell(DAY_TITLE_ROW[dayIdx], 1).value = `${dayName},${dayNum}${getOrdinalSuffix(dayNum)} ${monthYear}`;

        // Holiday check
        const isWeekdayHoliday = !isWeekend(dayDate) && holidaySet.has(dateStr);
        if (isWeekdayHoliday) {
          ws.getCell(headerRow, 5).value = 'HOLIDAY';
          ws.getCell(headerRow, 5).alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Staff data for this day
        for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
          const row = dataStart + staffIdx;
          const staffId = orderedStaff[staffIdx].id;
          const entry = staffId ? (entryByStaff[staffId] ?? null) : null;
          const amount = entry?.computedAmount != null ? parseFloat(String(entry.computedAmount)) : 0;

          if (entry?.arrivalTime) {
            const timeStr = String(entry.arrivalTime ?? '');
            const parts = timeStr.split(':');
            const hours = parseInt(parts[0] || '0', 10);
            const minutes = parseInt(parts[1] || '0', 10);
            const tc = ws.getCell(row, 2);
            tc.value = new Date(2000, 0, 1, hours, minutes);
            tc.numFmt = 'h:mm AM/PM';
          }

          if (amount > 0) {
            const ac = ws.getCell(row, 3);
            ac.value = amount;
            ac.numFmt = '"GHC "#,##0.00';
          }

          ws.getCell(row, 4).value = entry?.reason ?? undefined;
        }
      }

      // Add the filled worksheet to the final workbook via model clone
      // (preserves column widths, styling, merges — everything)
      const newSheet = workbook.addWorksheet(sheetName);
      const clonedModel = JSON.parse(JSON.stringify(ws.model));
      (clonedModel as any).cols = JSON.parse(JSON.stringify((ws.model as any).cols));

      // Re-create Date objects in cells since JSON.stringify converts them to ISO strings
      if (clonedModel.rows) {
        for (const row of clonedModel.rows) {
          if (!row || !row.cells) continue;
          for (const cell of row.cells) {
            if (!cell || cell.value === null || cell.value === undefined) continue;
            if (typeof cell.value === 'string') {
              // Try to parse as ISO date string
              const parsed = new Date(cell.value);
              if (!isNaN(parsed.getTime()) && /^\\d{4}-\\d{2}-\\d{2}T/.test(cell.value)) {
                cell.value = parsed;
              }
            }
          }
        }
      }

      newSheet.model = clonedModel;
      newSheet.state = ws.state;
    }

    const buffer = await workbook.xlsx.writeBuffer();

    // Audit log
    try {
      await db.insert(auditEvent).values({
        entityType: 'export',
        entityId: `monthly-${year}-${month + 1}`,
        action: 'EXPORT',
        beforeJson: null,
        afterJson: { year, month: month + 1, weekCount: weeks.length },
        actorUserId,
        actorEmail,
      });
    } catch (auditError) {
      console.error('Audit log failed:', auditError);
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Lateness_${format(monthStartDate, 'MMMM_yyyy')}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Monthly export failed:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Monthly export failed: ${errMsg}` }, { status: 500 });
  }
}