// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend, startOfMonth, endOfMonth, addDays } from 'date-fns';
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

    const monthStartDate = startOfMonth(new Date(year, month));
    const monthEnd = endOfMonth(new Date(year, month));

    // Find weeks that have at least one day in the month
    const weeks: { weekStart: Date; weekEnd: Date }[] = [];
    let cursor = new Date(monthStartDate);
    while (cursor.getDay() !== 1) cursor = addDays(cursor, -1);
    while (cursor <= monthEnd) {
      const rawWeekEnd = addDays(cursor, 4);
      const weekEnd = rawWeekEnd > monthEnd ? monthEnd : rawWeekEnd;
      if (weekEnd >= monthStartDate) {
        weeks.push({ weekStart: new Date(cursor), weekEnd });
      }
      cursor = addDays(cursor, 7);
    }

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
      const { weekStart, weekEnd } = weeks[w];
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      // Load template fresh for each week
      const weekBook = new ExcelJS.Workbook();
      await weekBook.xlsx.readFile(templatePath);
      const ws = weekBook.getWorksheet('WEEK 4') || weekBook.getWorksheet('WEEK 1');
      if (!ws) continue;

      const sheetName = `WEEK ${w + 1} - ${format(weekStart, 'MMM dd')}`;
      ws.name = sheetName;

      // Fetch entries + holidays for this week
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

      // Generate day dates — stop at month boundary
      const dayDates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        if (d > monthEnd) break;
        dayDates.push(format(d, 'yyyy-MM-dd'));
      }

      // Update date title rows
      for (let i = 0; i < 5; i++) {
        const dateStr = dayDates[i];
        if (!dateStr) continue;
        const d = parseISO(dateStr);
        const dayName = format(d, 'EEEE').toUpperCase();
        const dayNum = d.getDate();
        const monthYear = format(d, 'MMMM yyyy').toUpperCase();
        ws.getCell(DAY_TITLE_ROW[i], 1).value = `${dayName},${dayNum}${getOrdinalSuffix(dayNum)} ${monthYear}`;
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
        if (!dateStr) continue;
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
          } else {
            ws.getCell(row, 2).value = undefined;
          }

          if (amount > 0) {
            const ac = ws.getCell(row, 3);
            ac.value = amount;
            ac.numFmt = '"GHC "#,##0.00';
          }

          ws.getCell(row, 4).value = entry?.reason ?? undefined;
        }
      }

      // Add the filled worksheet to the final workbook — copy cells directly
      const newSheet = workbook.addWorksheet(sheetName);
      ws.eachRow((row, rowNum) => {
        row.eachCell((cell, colNum) => {
          const newCell = newSheet.getCell(rowNum, colNum);
          newCell.value = cell.value;
          newCell.numFmt = cell.numFmt;
          if (cell.font) newCell.font = JSON.parse(JSON.stringify(cell.font));
          if (cell.fill) newCell.fill = JSON.parse(JSON.stringify(cell.fill));
          if (cell.border) newCell.border = JSON.parse(JSON.stringify(cell.border));
          if (cell.alignment) newCell.alignment = JSON.parse(JSON.stringify(cell.alignment));
        });
      });

      // Copy merged cells
      const merges = (ws as any)._merges;
      if (merges) {
        for (const key of Object.keys(merges)) {
          const m = merges[key].model;
          newSheet.mergeCells(m.top, m.left, m.bottom, m.right);
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
        'Content-Disposition': `attachment; filename="Lateness_${format(monthStartDate, 'MMMM_yyyy')}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Monthly export failed:', error);
    return NextResponse.json({ error: 'Monthly export failed' }, { status: 500 });
  }
}