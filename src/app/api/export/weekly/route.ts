// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, addDays, parseISO, isWeekend } from 'date-fns';

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

    // Fetch all active staff from DB
    const allStaff = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.active, true),
    });

    // Map DB staff to fixed order (preserve template order, fill missing with null)
    const orderedStaff = STAFF_ORDER.map(name => {
      const found = allStaff.find(s => s.fullName === name);
      return found || null;
    }).filter(Boolean) as typeof allStaff;

    if (orderedStaff.length === 0) {
      return NextResponse.json({ error: 'No active staff found' }, { status: 400 });
    }

    // Fetch all entries for the week
    const entries = await db.query.latenessEntry.findMany({
      where: (entry, { and, gte, lte }) =>
        and(
          gte(entry.date, weekStart),
          lte(entry.date, weekEnd)
        ),
      with: {
        staff: true,
      },
    });

    // Fetch holidays for the week
    const holidays = await db.query.workCalendar.findMany({
      where: (cal, { and, gte, lte, eq }) =>
        and(
          gte(cal.date, weekStart),
          lte(cal.date, weekEnd),
          eq(cal.isHoliday, true)
        ),
    });
    const holidaySet = new Set(holidays.filter(h => !h.isRemoved).map(h => h.date));

    // Group entries by (date, staffId)
    const entryMap: Record<string, Record<string, typeof entries[0]>> = {};
    for (const entry of entries) {
      if (!entryMap[entry.date]) entryMap[entry.date] = {};
      entryMap[entry.date][entry.staffId] = entry;
    }

    // Helper: format time string "HH:MM" to "H:MM AM/PM"
    function formatTime(time: string): string {
      if (!time) return '';
      const [hours, minutes] = time.split(':').map(Number);
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayH = hours % 12 || 12;
      return `${displayH}:${minutes.toString().padStart(2, '0')} ${ampm}`;
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

    // Collect weekdays in range
    const weekdays: string[] = [];
    let currentDate = parseISO(weekStart);
    const endDate = parseISO(weekEnd);
    while (currentDate <= endDate) {
      if (!isWeekend(currentDate)) {
        weekdays.push(format(currentDate, 'yyyy-MM-dd'));
      }
      currentDate = addDays(currentDate, 1);
    }

    // Day layout: each day block occupies exactly 18 rows
    // title=1, blank=2, header=3, data=4-18 (15 staff rows)
    // Each subsequent day: +18 rows
    const DAY_BLOCK_SIZE = 18;
    const dayDataStartRows = weekdays.map((_, i) => 4 + i * DAY_BLOCK_SIZE);
    // e.g. [4, 22, 40, 58, 76] for Mon-Fri

    // ── Create Excel workbook ──────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lateness Book');
    worksheet.views = [{ showGridLines: false }];

    // Column widths match the LATENESS BOOK template
    worksheet.columns = [
      { key: 'name',   width: 26 },
      { key: 'time',   width: 13 },
      { key: 'amount', width: 16 },
      { key: 'reason', width: 44 },
      { key: 'holiday', width: 13 },
    ];

    function applyMediumBorder(row: ExcelJS.Row) {
      for (let i = 1; i <= 5; i++) {
        row.getCell(i).border = {
          top:    { style: 'medium' },
          bottom: { style: 'medium' },
          left:   { style: 'medium' },
          right:  { style: 'medium' },
        };
      }
    }

    function applyThinBorder(row: ExcelJS.Row) {
      for (let i = 1; i <= 5; i++) {
        row.getCell(i).border = {
          top:    { style: 'thin' },
          bottom: { style: 'thin' },
          left:   { style: 'thin' },
          right:  { style: 'thin' },
        };
      }
    }

    // ── Daily sections ─────────────────────────────────────────────────
    for (let dayIdx = 0; dayIdx < weekdays.length; dayIdx++) {
      const dateStr = weekdays[dayIdx];
      const d = parseISO(dateStr);
      const dayName = format(d, 'EEEE').toUpperCase();
      const dayNum = d.getDate();
      const suffix = getOrdinalSuffix(dayNum);
      const monthYear = format(d, 'MMMM yyyy').toUpperCase();
      const dateHeaderText = `${dayName},${dayNum}${suffix} ${monthYear}`;

      const isHoliday = holidaySet.has(dateStr);
      const dataStart = dayDataStartRows[dayIdx];

      // Row 1: date title (bold, medium border)
      const dateRow = worksheet.addRow([dateHeaderText, '', '', '', '']);
      dateRow.getCell(1).font = { bold: true, size: 11 };
      dateRow.getCell(1).alignment = { horizontal: 'left' };
      applyMediumBorder(dateRow);

      // Row 2: blank spacer (no border)
      worksheet.addRow(['', '', '', '', '']);

      // Row 3: column headers (white on blue, centered, medium border)
      const colHeaderRow = worksheet.addRow(['NAME', 'TIME', 'AMOUNT', 'REASON', 'HOLIDAY']);
      for (let i = 1; i <= 5; i++) {
        const cell = colHeaderRow.getCell(i);
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = {
          top:    { style: 'medium' },
          bottom: { style: 'medium' },
          left:   { style: 'medium' },
          right:  { style: 'medium' },
        };
      }

      // Rows 4–18: staff rows (thin border)
      for (let staffIdx = 0; staffIdx < orderedStaff.length; staffIdx++) {
        const s = orderedStaff[staffIdx];
        const entry = entryMap[dateStr]?.[s.id];
        const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;

        const dataRow = worksheet.addRow([
          s.fullName,
          entry?.arrivalTime ? formatTime(entry.arrivalTime) : '',
          amount > 0 ? amount : '',        // numeric, not string
          entry?.reason || '',
          isHoliday ? 'HOLIDAY' : '',
        ]);

        for (let i = 1; i <= 5; i++) {
          const cell = dataRow.getCell(i);
          cell.font = { size: 10 };
          cell.border = {
            top:    { style: 'thin' },
            bottom: { style: 'thin' },
            left:   { style: 'thin' },
            right:  { style: 'thin' },
          };
        }

        // Amount column: plain number (no "GHC" prefix so SUM formulas work)
        const amountCell = dataRow.getCell(3);
        if (amount > 0) {
          amountCell.numFmt = '"GHC "#,##0.00';
        }
      }
    }

    // ── Weekly totals section ──────────────────────────────────────────
    // Blank spacer row
    worksheet.addRow(['', '', '', '', '']);

    // "NAME" | "TOTAL AMOUNT FOR THE WEEK" header row
    const totalHeaderRow = worksheet.addRow(['NAME', 'TOTAL AMOUNT FOR THE WEEK', '', '', '']);
    totalHeaderRow.getCell(1).font = { bold: true, size: 11 };
    totalHeaderRow.getCell(1).alignment = { horizontal: 'left' };
    totalHeaderRow.getCell(2).font = { bold: true, size: 11 };
    totalHeaderRow.getCell(2).alignment = { horizontal: 'left' };
    applyMediumBorder(totalHeaderRow);

    // Per-staff SUM formulas: for each staff member, sum their AMOUNT cells across all days
    const totalsStartRow = worksheet.rowCount + 1; // after last added row
    for (let staffIdx = 0; staffIdx < orderedStaff.length; staffIdx++) {
      const s = orderedStaff[staffIdx];

      // Build cell references for each day's AMOUNT column (col 3) for this staff member
      const amountRefs = dayDataStartRows.map(startRow => {
        const row = startRow + staffIdx;
        return `C${row}`;
      }).join(',');

      const totalRow = worksheet.addRow([
        s.fullName,
        `=SUM(${amountRefs})`,  // e.g. =SUM(C4,C22,C40,C58,C76)
        '', '', ''
      ]);

      for (let i = 1; i <= 5; i++) {
        const cell = totalRow.getCell(i);
        cell.font = { size: 10 };
        cell.border = {
          top:    { style: 'thin' },
          bottom: { style: 'thin' },
          left:   { style: 'thin' },
          right:  { style: 'thin' },
        };
      }

      // Format B column as GHC amount
      totalRow.getCell(2).numFmt = '"GHC "#,##0.00';
    }

    // Grand total row
    const grandTotalRowNum = worksheet.rowCount + 1;
    const grandTotalRow = worksheet.addRow(['TOTAL:', `=SUM(B${totalsStartRow}:B${grandTotalRowNum - 1})`, '', '', '']);
    grandTotalRow.getCell(1).font = { bold: true, size: 11 };
    grandTotalRow.getCell(2).font = { bold: true, size: 11 };
    grandTotalRow.getCell(2).numFmt = '"GHC "#,##0.00';
    applyMediumBorder(grandTotalRow);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

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