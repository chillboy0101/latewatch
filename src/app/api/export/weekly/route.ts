// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO } from 'date-fns';
import path from 'path';

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
    const allStaffRows = await db.select({
      id: staff.id,
      fullName: staff.fullName,
      active: staff.active,
    })
    .from(staff)
    .where(eq(staff.active, true));

    // Map DB staff to fixed order
    const staffNameToId: Record<string, string> = {};
    for (const s of allStaffRows) {
      staffNameToId[s.fullName] = s.id;
    }

    // Build ordered staff list matching template
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

    // Helper: format time string "HH:MM" to "H:MM AM/PM"
    function formatTime(time: string | null): string {
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

    // ── Load template workbook ─────────────────────────────────────────
    const templatePath = path.join(process.cwd(), 'public', 'lateness-book.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet('WEEK 4') || workbook.getWorksheet('WEEK 1');

    if (!worksheet) {
      return NextResponse.json({ error: 'Template sheet not found' }, { status: 500 });
    }

    // ── Day layout from template ────────────────────────────────────────
    // Each day block: date title row, blank row, header row, 15 data rows, blank spacer
    // Row indices (1-based) for each day start:
    const DAY_STARTS = [1, 19, 37, 55, 73]; // title rows for Mon-Fri
    const DAY_DATA_START = [4, 22, 40, 58, 76]; // first staff data row per day

    // Map weekStart/weekEnd to which day blocks to fill
    // First, find the Mon of the week containing weekStart
    const weekStartDate = parseISO(weekStart);
    const dayOfWeek = weekStartDate.getDay(); // 0=Sun, 1=Mon...
    // weekStart should be Monday
    // Each day block = 18 rows (title+blank+header+15 staff+spacer)

    // Determine how many days in this week (Mon-Fri)
    const dayDates: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate() + i);
      dayDates.push(format(d, 'yyyy-MM-dd'));
    }

    // ── Update date headers ─────────────────────────────────────────────
    for (let i = 0; i < dayDates.length; i++) {
      const dateStr = dayDates[i];
      const d = parseISO(dateStr);
      const dayName = format(d, 'EEEE').toUpperCase();
      const dayNum = d.getDate();
      const suffix = getOrdinalSuffix(dayNum);
      const monthYear = format(d, 'MMMM yyyy').toUpperCase();
      const titleText = `${dayName},${dayNum}${suffix} ${monthYear}`;

      const titleRowIdx = DAY_STARTS[i];
      const cell = worksheet.getCell(titleRowIdx, 1);
      cell.value = titleText;
    }

    // ── Fill in data rows ───────────────────────────────────────────────
    for (let dayIdx = 0; dayIdx < dayDates.length; dayIdx++) {
      const dateStr = dayDates[dayIdx];
      const dataStartRow = DAY_DATA_START[dayIdx];
      const isHoliday = holidaySet.has(dateStr);

      for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
        const row = dataStartRow + staffIdx;
        const staffId = orderedStaff[staffIdx].id;
        const entry = staffId ? entryByStaff[staffId] : null;
        const amount = entry ? parseFloat(String(entry.computedAmount || '0')) : 0;

        // TIME (col 2)
        const timeCell = worksheet.getCell(row, 2);
        if (entry?.arrivalTime) {
          timeCell.value = entry.arrivalTime;
          timeCell.numFmt = 'hh:mm AM/PM';
        } else {
          timeCell.value = '';
        }

        // AMOUNT (col 3)
        const amountCell = worksheet.getCell(row, 3);
        amountCell.value = amount > 0 ? amount : '';

        // REASON (col 4)
        const reasonCell = worksheet.getCell(row, 4);
        reasonCell.value = entry?.reason || '';

        // HOLIDAY column (col 5) — already has "HOLIDAY" text via merge from template
        // For non-holiday days, leave as-is (empty after the header row)
      }
    }

    // ── Save & return ───────────────────────────────────────────────────
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