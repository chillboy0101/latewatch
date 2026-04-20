// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent } from '@/db/schema';
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

    // Fetch ALL active staff in alphabetical order
    const allStaff = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.active, true),
      orderBy: (s, { asc }) => [asc(s.fullName)],
    });

    if (allStaff.length === 0) {
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

    // Group entries by date and staffId for fast lookup
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

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lateness Book');

    // Disable gridlines for cleaner look
    worksheet.views = [{ showGridLines: false }];

    // Set column widths
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Time', key: 'time', width: 12 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Reason', key: 'reason', width: 45 },
      { header: 'Holiday', key: 'holiday', width: 15 },
    ];

    // Helper: generate date header row text like "MONDAY,23RD MARCH 2026"
    function formatDateHeader(dateStr: string): string {
      const d = parseISO(dateStr);
      const dayName = format(d, 'EEEE').toUpperCase();
      const dayNum = d.getDate();
      const suffix = getOrdinalSuffix(dayNum);
      const monthYear = format(d, 'MMMM yyyy').toUpperCase();
      return `${dayName},${dayNum}${suffix} ${monthYear}`;
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

    // Collect all weekdays in the range
    const weekdays: string[] = [];
    let currentDate = parseISO(weekStart);
    const endDate = parseISO(weekEnd);
    while (currentDate <= endDate) {
      if (!isWeekend(currentDate)) {
        weekdays.push(format(currentDate, 'yyyy-MM-dd'));
      }
      currentDate = addDays(currentDate, 1);
    }

    // Track per-staff weekly totals
    const staffTotals: Record<string, number> = {};
    for (const s of allStaff) staffTotals[s.id] = 0;

    // Style for date header rows
    const dateHeaderStyle = {
      font: { bold: true, size: 11 },
      alignment: { horizontal: 'left' as const },
    };

    // Style for column headers
    const colHeaderStyle = {
      font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2563EB' } },
      alignment: { horizontal: 'center' as const },
      border: {
        top: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        left: { style: 'thin' as const },
        right: { style: 'thin' as const },
      },
    };

    // Style for data rows
    const dataRowStyle = {
      font: { size: 10 },
      border: {
        top: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        left: { style: 'thin' as const },
        right: { style: 'thin' as const },
      },
    };

    // Style for total header
    const totalHeaderStyle = {
      font: { bold: true, size: 11 },
      alignment: { horizontal: 'left' as const },
    };

    // Generate sheet sections for each weekday
    for (const dateStr of weekdays) {
      // Date header row
      const dateRow = worksheet.addRow([
        formatDateHeader(dateStr), '', '', '', ''
      ]);
      dateRow.getCell(1).font = dateHeaderStyle.font;
      dateRow.getCell(1).alignment = dateHeaderStyle.alignment;
      // Apply border to all cells in date row
      for (let i = 1; i <= 5; i++) {
        dateRow.getCell(i).border = {
          top: { style: 'medium' as const },
          bottom: { style: 'medium' as const },
          left: { style: 'medium' as const },
          right: { style: 'medium' as const },
        };
      }

      // Column header row
      const colHeaderRow = worksheet.addRow(['NAME', 'TIME', 'AMOUNT', 'REASON', 'HOLIDAY']);
      for (let i = 1; i <= 5; i++) {
        const cell = colHeaderRow.getCell(i);
        cell.font = colHeaderStyle.font;
        cell.fill = colHeaderStyle.fill;
        cell.alignment = colHeaderStyle.alignment;
        cell.border = colHeaderStyle.border;
      }

      // Check if this is a holiday
      const isHoliday = holidaySet.has(dateStr);

      // All staff rows
      for (const s of allStaff) {
        const entry = entryMap[dateStr]?.[s.id];
        const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;
        if (entry && amount > 0) {
          staffTotals[s.id] += amount;
        }

        const dataRow = worksheet.addRow([
          s.fullName,
          entry?.arrivalTime ? formatTime(entry.arrivalTime) : '',
          amount > 0 ? `GHC ${amount.toFixed(2)}` : '',
          entry?.reason || '',
          isHoliday ? 'HOLIDAY' : '',
        ]);

        for (let i = 1; i <= 5; i++) {
          const cell = dataRow.getCell(i);
          cell.font = dataRowStyle.font;
          cell.border = dataRowStyle.border;
          if (i === 4 && entry?.reason) {
            // Reason column - wrap text
            cell.alignment = { wrapText: true };
          }
        }
      }

      // Spacer row - no borders
      const spacerRow = worksheet.addRow(['', '', '', '', '']);
    }

    // === WEEKLY TOTALS SECTION ===
    // Spacer
    worksheet.addRow(['', '', '', '', '']);

    // Total header row
    const totalHeaderRow = worksheet.addRow(['NAME', 'TOTAL AMOUNT FOR THE WEEK', '', '', '']);
    totalHeaderRow.getCell(1).font = totalHeaderStyle.font;
    totalHeaderRow.getCell(1).alignment = totalHeaderStyle.alignment;
    for (let i = 1; i <= 5; i++) {
      totalHeaderRow.getCell(i).border = {
        top: { style: 'medium' as const },
        bottom: { style: 'medium' as const },
        left: { style: 'medium' as const },
        right: { style: 'medium' as const },
      };
    }

    // Per-staff totals
    let grandTotal = 0;
    for (const s of allStaff) {
      const total = staffTotals[s.id];
      grandTotal += total;
      const totalRow = worksheet.addRow([
        s.fullName,
        `GHC ${total.toFixed(2)}`,
        '', '', ''
      ]);
      for (let i = 1; i <= 5; i++) {
        const cell = totalRow.getCell(i);
        cell.font = dataRowStyle.font;
        cell.border = dataRowStyle.border;
      }
    }

    // Grand total row - bold and larger
    const grandTotalRow = worksheet.addRow(['TOTAL:', `GHC ${grandTotal.toFixed(2)}`, '', '', '']);
    grandTotalRow.getCell(1).font = { bold: true, size: 11 };
    grandTotalRow.getCell(2).font = { bold: true, size: 11 };
    for (let i = 1; i <= 5; i++) {
      const cell = grandTotalRow.getCell(i);
      cell.border = {
        top: { style: 'medium' as const },
        bottom: { style: 'medium' as const },
        left: { style: 'medium' as const },
        right: { style: 'medium' as const },
      };
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Audit log (non-blocking - don't fail export if audit fails)
    try {
      await db.insert(auditEvent).values({
        entityType: 'export',
        entityId: `weekly-${weekStart}-${weekEnd}`,
        action: 'EXPORT',
        beforeJson: null,
        afterJson: { weekStart, weekEnd, grandTotal, staffCount: allStaff.length },
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
    console.error('Error details:', errMsg);
    return NextResponse.json({ error: `Export failed: ${errMsg}` }, { status: 500 });
  }
}
