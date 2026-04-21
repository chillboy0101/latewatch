// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend, startOfMonth, endOfMonth, addDays } from 'date-fns';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month } = body;

    if (year === undefined || month === undefined) {
      return NextResponse.json({ error: 'Year and month required' }, { status: 400 });
    }

    // Get current user for audit
    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

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

    const DAY_DATA_START = [4, 22, 40, 58, 76];
    const DAY_HEADER_ROW  = [3, 21, 39, 57, 75];
    const DAY_TITLE_ROW   = [1, 19, 37, 55, 73];

    const monthStart = startOfMonth(new Date(year, month));
    const monthEnd = endOfMonth(new Date(year, month));

    // Find all Mon-Fri weeks in the month
    const weeks: { weekStart: Date; weekEnd: Date }[] = [];
    let cursor = new Date(monthStart);
    while (cursor.getDay() !== 1) cursor = addDays(cursor, 1);

    while (cursor <= monthEnd) {
      const weekEnd = addDays(cursor, 4);
      if (weekEnd >= monthStart) {
        weeks.push({ weekStart: new Date(cursor), weekEnd });
      }
      cursor = addDays(cursor, 7);
    }

    const allStaffRows = await db.select({ id: staff.id, fullName: staff.fullName })
      .from(staff)
      .where(eq(staff.active, true));

    const staffNameToId: Record<string, string> = {};
    for (const s of allStaffRows) staffNameToId[s.fullName] = s.id;

    const orderedStaff = STAFF_ORDER.map(name => ({
      name,
      id: staffNameToId[name] || null,
    }));

    const templatePath = path.join(process.cwd(), 'src', 'lateness-book.xlsx');

    // One workbook, add a sheet per week
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LateWatch';
    workbook.created = new Date();
    // Remove default sheet
    workbook.removeWorksheet(workbook.getWorksheet(1)?.id || 1);

    for (let w = 0; w < weeks.length; w++) {
      const { weekStart, weekEnd } = weeks[w];
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      // Load template fresh for each week
      const weekBook = new ExcelJS.Workbook();
      await weekBook.xlsx.readFile(templatePath);
      const ws = weekBook.getWorksheet('WEEK 4') || weekBook.getWorksheet('WEEK 1');
      if (!ws) continue;

      const sheetName = `WEEK ${w + 1} - ${format(weekStart, 'MMM dd')}`;

      // Fetch entries for this week
      const entries = await db.select({
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        computedAmount: latenessEntry.computedAmount,
        reason: latenessEntry.reason,
      })
      .from(latenessEntry)
      .where(and(gte(latenessEntry.date, weekStartStr), lte(latenessEntry.date, weekEndStr)));

      // Fetch holidays for this week
      const holidays = await db.select({ date: workCalendar.date })
        .from(workCalendar)
        .where(and(gte(workCalendar.date, weekStartStr), lte(workCalendar.date, weekEndStr), eq(workCalendar.isHoliday, true)));

      const holidaySet = new Set(holidays.map(h => h.date));
      const entryByStaff: Record<string, typeof entries[0]> = {};
      for (const e of entries) entryByStaff[e.staffId] = e;

      // Generate 5 day dates
      const dayDates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        dayDates.push(format(d, 'yyyy-MM-dd'));
      }

      // Update date title rows
      for (let i = 0; i < 5; i++) {
        const dateStr = dayDates[i];
        const d = parseISO(dateStr);
        const dayName = format(d, 'EEEE').toUpperCase();
        const dayNum = d.getDate();
        const suffix = (n: number) => { if (n > 3 && n < 21) return 'TH'; switch (n % 10) { case 1: return 'ST'; case 2: return 'ND'; case 3: return 'RD'; default: return 'TH'; } };
        const monthYear = format(d, 'MMMM yyyy').toUpperCase();
        ws.getCell(DAY_TITLE_ROW[i], 1).value = `${dayName},${dayNum}${suffix(dayNum)} ${monthYear}`;
      }

      // Clear all day block data
      for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
        const dataStart = DAY_DATA_START[dayIdx];
        for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
          const row = dataStart + staffIdx;
          ws.getCell(row, 3).value = undefined;
          ws.getCell(row, 4).value = undefined;
        }
        ws.getCell(DAY_HEADER_ROW[dayIdx], 5).value = undefined;
      }

      // Fill in data
      for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
        const dateStr = dayDates[dayIdx];
        const dataStart = DAY_DATA_START[dayIdx];
        const headerRow = DAY_HEADER_ROW[dayIdx];
        const d = parseISO(dateStr);

        const isWeekdayHoliday = !isWeekend(d) && holidaySet.has(dateStr);

        const holidayCell = ws.getCell(headerRow, 5);
        if (isWeekdayHoliday) {
          holidayCell.value = 'HOLIDAY';
          holidayCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
          const row = dataStart + staffIdx;
          const staffId = orderedStaff[staffIdx].id;
          const entry = staffId ? entryByStaff[staffId] : null;
          const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;

          if (entry?.arrivalTime) {
            const [hours, minutes] = entry.arrivalTime.split(':').map(Number);
            const timeDate = new Date(2000, 0, 1, hours, minutes);
            const tc = ws.getCell(row, 2);
            tc.value = timeDate;
            tc.numFmt = 'h:mm AM/PM';
          } else {
            ws.getCell(row, 2).value = undefined;
          }

          if (amount > 0) {
            const ac = ws.getCell(row, 3);
            ac.value = amount;
            ac.numFmt = '"GHC "#,##0.00';
          }

          ws.getCell(row, 4).value = entry?.reason || undefined;
        }
      }

      // Copy the worksheet (with all formatting intact) into the final workbook
      const srcSheet = ws;
      const newSheet = workbook.addWorksheet(sheetName);

      // Copy all rows (including styled-empty rows) by iterating model rows
      // Build a lookup of rowNum -> modelRow for fast access
      const modelRowsByNum: Record<number, any> = {};
      const modelRows: any[] = (srcSheet as any).model?.rows || [];
      for (const mr of modelRows) {
        if (mr.number) modelRowsByNum[mr.number] = mr;
      }

      // Iterate ALL rows from 1 to the last row in the template
      const lastRow = (srcSheet as any).model?.table?.rows?.length
        ? Math.max(...modelRows.map((mr: any) => mr.number).filter(Boolean))
        : 95;

      for (let rowNum = 1; rowNum <= lastRow; rowNum++) {
        const modelRow = modelRowsByNum[rowNum];
        if (!modelRow) continue; // empty/unstyled row — skip

        for (const modelCell of modelRow.cells || []) {
          const colNum = modelCell.index + 1;
          const cell = newSheet.getCell(rowNum, colNum);
          if (modelCell.value !== undefined) cell.value = modelCell.value;
          if (modelCell.numFmt) cell.numFmt = modelCell.numFmt;
          if (modelCell.alignment) cell.alignment = modelCell.alignment;
          if (modelCell.font) cell.font = modelCell.font;
          if (modelCell.fill) cell.fill = modelCell.fill;
          if (modelCell.border) cell.border = modelCell.border;
        }
      }

      // Copy column widths
      srcSheet.columns.forEach((col, idx) => {
        if (col.width) newSheet.getColumn(idx + 1).width = col.width;
      });

      // Copy merge ranges
      if ((srcSheet as any).model?.merges) {
        for (const merge of (srcSheet as any).model.merges) {
          newSheet.mergeCells(merge);
        }
      }
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
        'Content-Disposition': `attachment; filename="Lateness_${format(monthStart, 'MMMM_yyyy')}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Monthly export failed:', error);
    return NextResponse.json({ error: 'Monthly export failed' }, { status: 500 });
  }
}
