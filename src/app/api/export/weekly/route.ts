// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO, isWeekend } from 'date-fns';
import path from 'path';
import { fileURLToPath } from 'url';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { weekStart, weekEnd } = body;

    if (!weekStart || !weekEnd) {
      return NextResponse.json({ error: 'Week start and end required' }, { status: 400 });
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

    // ── Fixed staff order matching the LATENESS BOOK template ──────────
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
    // Each block: title, blank, header, 15 staff rows, spacer = 18 rows
    // MON: title=1,  header=3,  data_start=4,   spacer=19
    // TUE: title=19, header=21, data_start=22, spacer=37
    // WED: title=37, header=39, data_start=40, spacer=55
    // THU: title=55, header=57, data_start=58, spacer=73
    // FRI: title=73, header=75, data_start=76, spacer=91
    const DAY_DATA_START = [4, 22, 40, 58, 76];  // first staff data row per day
    const DAY_HEADER_ROW  = [3, 21, 39, 57, 75];  // column header row per day (HOLIDAY col E)
    const DAY_TITLE_ROW   = [1, 19, 37, 55, 73];  // date title row per day

    // Fetch all active staff from DB
    const allStaffRows = await db.select({
      id: staff.id,
      fullName: staff.fullName,
    })
    .from(staff)
    .where(eq(staff.active, true));

    // Map DB staff name → id
    const staffNameToId: Record<string, string> = {};
    for (const s of allStaffRows) {
      staffNameToId[s.fullName] = s.id;
    }

    // Build ordered staff list matching template (null if not in DB)
    const orderedStaff = STAFF_ORDER.map(name => ({
      name,
      id: staffNameToId[name] || null,
    }));

    // Fetch all entries for the week
    const entries = await db.select({
      staffId: latenessEntry.staffId,
      date: latenessEntry.date,
      arrivalTime: latenessEntry.arrivalTime,
      computedAmount: latenessEntry.computedAmount,
      reason: latenessEntry.reason,
    })
    .from(latenessEntry)
    .where(and(gte(latenessEntry.date, weekStart), lte(latenessEntry.date, weekEnd)));

    // Fetch holidays for the week
    const holidays = await db.select({ date: workCalendar.date })
    .from(workCalendar)
    .where(and(gte(workCalendar.date, weekStart), lte(workCalendar.date, weekEnd), eq(workCalendar.isHoliday, true)));

    const holidaySet = new Set(holidays.map(h => h.date));

    // Group entries by staffId for fast lookup
    const entryByStaff: Record<string, typeof entries[0]> = {};
    for (const e of entries) {
      entryByStaff[e.staffId] = e;
    }

    function getOrdinalSuffix(n: number): string {
      if (n > 3 && n < 21) return 'TH';
      switch (n % 10) {
        case 1: return 'ST';
        case 2: return 'ND';
        case 3: return 'RD';
        default: return 'TH';
      }
    }

    // ── Load template workbook — resolve from project root (process.cwd()) ──────────
    const templatePath = path.join(process.cwd(), 'src', 'lateness-book.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet('WEEK 4') || workbook.getWorksheet('WEEK 1');

    if (!worksheet) {
      return NextResponse.json({ error: 'Template sheet not found' }, { status: 500 });
    }

    // Determine the 5 dates for this week (Mon→Fri from weekStart)
    const weekStartDate = parseISO(weekStart);
    const dayDates: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate() + i);
      dayDates.push(format(d, 'yyyy-MM-dd'));
    }

    // ── Update date title rows ──────────────────────────────────────────
    for (let i = 0; i < 5; i++) {
      const dateStr = dayDates[i];
      const d = parseISO(dateStr);
      const dayName = format(d, 'EEEE').toUpperCase();
      const dayNum = d.getDate();
      const suffix = getOrdinalSuffix(dayNum);
      const monthYear = format(d, 'MMMM yyyy').toUpperCase();
      const titleText = `${dayName},${dayNum}${suffix} ${monthYear}`;

      const cell = worksheet.getCell(DAY_TITLE_ROW[i], 1);
      cell.value = titleText;
    }

    // ── Clear all AMOUNT (C) and REASON (D) cells in day rows first ─────
    // This removes any stale data from a previous export session
    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const dataStart = DAY_DATA_START[dayIdx];
      for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
        const row = dataStart + staffIdx;
        worksheet.getCell(row, 3).value = undefined;  // clear AMOUNT
        worksheet.getCell(row, 4).value = undefined;  // clear REASON
      }
    }

    // ── Fill in TIME (col B), AMOUNT (col C), REASON (col D) ───────────
    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const dateStr = dayDates[dayIdx];
      const dataStart = DAY_DATA_START[dayIdx];
      const headerRow = DAY_HEADER_ROW[dayIdx];
      const d = parseISO(dateStr);

      const isWeekdayHoliday = !isWeekend(d) && holidaySet.has(dateStr);

      // Holiday cell (col E) — write in header row; the merge spans all staff rows
      const holidayCell = worksheet.getCell(headerRow, 5);
      holidayCell.value = isWeekdayHoliday ? 'HOLIDAY' : '';
      if (isWeekdayHoliday) {
        holidayCell.alignment = { horizontal: 'center', vertical: 'center' };
      }

      for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
        const row = dataStart + staffIdx;
        const staffId = orderedStaff[staffIdx].id;
        const entry = staffId ? entryByStaff[staffId] : null;
        const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;

        // TIME (col 2)
        const timeCell = worksheet.getCell(row, 2);
        if (entry?.arrivalTime) {
          const [hours, minutes] = entry.arrivalTime.split(':').map(Number);
          const timeDate = new Date(2000, 0, 1, hours, minutes);
          timeCell.value = timeDate;
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
        // If amount is 0, leave it cleared (undefined) from the pre-clear above

        // REASON (col 4)
        const reasonCell = worksheet.getCell(row, 4);
        reasonCell.value = entry?.reason || undefined;
      }
    }

    // ── Save & return ───────────────────────────────────────────────────
    // B95:B110 SUM formulas are preserved from template — they auto-calculate
    // when AMOUNT cells (col C) are populated with real numbers above

    // Audit log (non-blocking)
    try {
      await db.insert(auditEvent).values({
        entityType: 'export',
        entityId: `weekly-${weekStart}-${weekEnd}`,
        action: 'EXPORT',
        beforeJson: null,
        afterJson: { weekStart, weekEnd, staffCount: orderedStaff.length },
        actorUserId,
        actorEmail,
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