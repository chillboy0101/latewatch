// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, auditEvent, staff } from '@/db/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { currentUser } from '@clerk/nextjs/server';
import { format, parseISO } from 'date-fns';
import path from 'path';

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
// Index 0=Monday block, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday
const DAY_DATA_START = [4, 22, 40, 58, 76];
const DAY_HEADER_ROW  = [3, 21, 39, 57, 75];
const DAY_TITLE_ROW   = [1, 19, 37, 55, 73];

function getOrdinalSuffix(n: number): string {
  if (n > 3 && n < 21) return 'TH';
  switch (n % 10) { case 1: return 'ST'; case 2: return 'ND'; case 3: return 'RD'; default: return 'TH'; }
}

/**
 * Returns which template slot (0-4, Mon-Fri) a given date maps to.
 * Returns -1 if the date is a weekend.
 */
function dayToSlot(d: Date): number {
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (dow === 0 || dow === 6) return -1; // weekend
  return dow - 1; // Mon(1)→0, Tue(2)→1, Wed(3)→2, Thu(4)→3, Fri(5)→4
}

/**
 * Build a weekly workbook for the given Mon-Fri date range.
 * Returns a workbook with one sheet matching the lateness-book template,
 * populated with the week's data.
 */
export async function buildWeeklyWorkbook(
  weekStart: string,
  weekEnd: string,
  actorUserId?: string | null,
  actorEmail?: string,
  actualMonthEnd?: string,
): Promise<ExcelJS.Workbook> {
  const templatePath = path.join(process.cwd(), 'src', 'lateness-book.xlsx');

  // Fetch all active staff from DB
  const allStaffRows = await db.select({ id: staff.id, fullName: staff.fullName })
    .from(staff)
    .where(eq(staff.active, true));

  const staffNameToId: Record<string, string> = {};
  for (const s of allStaffRows) staffNameToId[s.fullName] = s.id;

  const orderedStaff = STAFF_ORDER.map(name => ({ name, id: staffNameToId[name] || null }));

  // Fetch entries for the week
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
  const entryByStaff: Record<string, typeof entries[0]> = {};
  for (const e of entries) entryByStaff[e.staffId] = e;

  // Load template
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const worksheet = workbook.getWorksheet('WEEK 4') || workbook.getWorksheet('WEEK 1');
  if (!worksheet) throw new Error('Template sheet not found');

  // Determine the actual valid days for this week within the month range
  // (respects month boundaries and excludes weekends)
  const startDate = parseISO(weekStart);
  const endDate = parseISO(weekEnd);

  // Build list of valid (non-weekend) dates for this week
  const validDays: { date: Date; dateStr: string; slot: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + 86400000)) {
    const slot = dayToSlot(d);
    if (slot === -1) continue; // skip weekend
    // Respect actual month end if provided (used by monthly export)
    if (actualMonthEnd && d > parseISO(actualMonthEnd)) continue;
    validDays.push({
      date: new Date(d),
      dateStr: format(d, 'yyyy-MM-dd'),
      slot,
    });
  }

  // Update date title rows only for days that exist in this week
  for (const day of validDays) {
    const dayName = format(day.date, 'EEEE').toUpperCase();
    const dayNum = day.date.getDate();
    const monthYear = format(day.date, 'MMMM yyyy').toUpperCase();
    const titleText = `${dayName},${dayNum}${getOrdinalSuffix(dayNum)} ${monthYear}`;
    worksheet.getCell(DAY_TITLE_ROW[day.slot], 1).value = titleText;
  }

  // Clear all AMOUNT (C), REASON (D), and HOLIDAY (E) cells for all 5 blocks first
  for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
    const dataStart = DAY_DATA_START[dayIdx];
    for (let staffIdx = 0; staffIdx < STAFF_ORDER.length; staffIdx++) {
      const row = dataStart + staffIdx;
      worksheet.getCell(row, 3).value = undefined;
      worksheet.getCell(row, 4).value = undefined;
    }
    worksheet.getCell(DAY_HEADER_ROW[dayIdx], 5).value = undefined;
  }

  // Fill TIME (col B), AMOUNT (col C), REASON (col D) for each valid day
  for (const day of validDays) {
    const { dateStr, slot } = day;
    const dataStart = DAY_DATA_START[slot];
    const headerRow = DAY_HEADER_ROW[slot];
    const d = new Date(dateStr);

    const isWeekdayHoliday = holidaySet.has(dateStr);
    if (isWeekdayHoliday) {
      const holidayCell = worksheet.getCell(headerRow, 5);
      holidayCell.value = 'HOLIDAY';
      holidayCell.alignment = { horizontal: 'center', vertical: 'middle' };
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
        timeCell.value = new Date(2000, 0, 1, hours, minutes);
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

      // REASON (col 4)
      worksheet.getCell(row, 4).value = entry?.reason || undefined;
    }
  }

  // Set GHC currency format on TOTAL column B (rows 95-110)
  for (let r = 95; r <= 110; r++) {
    worksheet.getCell(r, 2).numFmt = '"GHC "#,##0.00';
  }

  return workbook;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { weekStart, weekEnd } = body;

    if (!weekStart || !weekEnd) {
      return NextResponse.json({ error: 'Week start and end required' }, { status: 400 });
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

    const workbook = await buildWeeklyWorkbook(weekStart, weekEnd, actorUserId, actorEmail);
    const buffer = await workbook.xlsx.writeBuffer();

    // Audit log (non-blocking)
    try {
      await db.insert(auditEvent).values({
        entityType: 'export',
        entityId: `weekly-${weekStart}-${weekEnd}`,
        action: 'EXPORT',
        beforeJson: null,
        afterJson: { weekStart, weekEnd, staffCount: STAFF_ORDER.length },
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