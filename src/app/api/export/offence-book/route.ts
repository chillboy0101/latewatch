import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPaymentAllocation, offenceBookItem, staff } from '@/db/schema';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { buildOffenceBookWorkbookFromData, type OffenceBookItemInput } from '@/lib/offence-book-export';

export const dynamic = 'force-dynamic';

const PAYMENT_SYNC_START_DATE = '2000-01-01';

function parseExportInput(body: unknown) {
  const year = Number((body as { year?: unknown })?.year);
  const month = Number((body as { month?: unknown })?.month);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;

  return { month, year };
}

function normalizeDateKey(value: string | Date) {
  return value instanceof Date ? format(value, 'yyyy-MM-dd') : value.slice(0, 10);
}

function fileNameForOffenceBook(year: number, month: number) {
  return `OFFENCE_BOOK_${format(new Date(year, month, 1), 'MMMM_yyyy')}.xlsx`;
}

export async function buildOffenceBookExportWorkbook(input: {
  month: number;
  year: number;
}) {
  const monthDate = new Date(input.year, input.month, 1);
  const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd');

  await syncLatenessEntriesFromAttendanceForRange(PAYMENT_SYNC_START_DATE, monthEnd);

  const staffRows = await db.select({
    fullName: staff.fullName,
    id: staff.id,
  })
    .from(staff)
    .where(and(
      eq(staff.active, true),
      eq(staff.archived, false),
      eq(staff.isAttendanceOnly, false),
    ))
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

  const staffIds = staffRows.map((member) => member.id);
  const entryRows = staffIds.length === 0
    ? []
    : await db.select({
      computedAmount: latenessEntry.computedAmount,
      date: latenessEntry.date,
      id: latenessEntry.id,
      staffId: latenessEntry.staffId,
    })
      .from(latenessEntry)
      .where(and(
        inArray(latenessEntry.staffId, staffIds),
        lte(latenessEntry.date, monthEnd),
      ));

  const entryIds = entryRows.map((entry) => entry.id);
  const allocationRows = entryIds.length === 0
    ? []
    : await db.select({
      allocatedAmount: latenessPaymentAllocation.allocatedAmount,
      entryId: latenessPaymentAllocation.entryId,
    })
      .from(latenessPaymentAllocation)
      .where(inArray(latenessPaymentAllocation.entryId, entryIds));

  const itemRows = await db.select({
    amount: offenceBookItem.amount,
    displayOrder: offenceBookItem.displayOrder,
    itemType: offenceBookItem.itemType,
    label: offenceBookItem.label,
    monthKey: offenceBookItem.monthKey,
  })
    .from(offenceBookItem)
    .where(lte(offenceBookItem.monthKey, monthStart))
    .orderBy(asc(offenceBookItem.monthKey), asc(offenceBookItem.itemType), asc(offenceBookItem.displayOrder));

  const workbook = await buildOffenceBookWorkbookFromData({
    allocations: allocationRows,
    entries: entryRows.map((entry) => ({
      ...entry,
      date: normalizeDateKey(entry.date),
    })),
    items: itemRows.map((item) => ({
      ...item,
      itemType: item.itemType as OffenceBookItemInput['itemType'],
      monthKey: normalizeDateKey(item.monthKey),
    })),
    month: input.month,
    staff: staffRows,
    year: input.year,
  });
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    buffer,
    fileName: fileNameForOffenceBook(input.year, input.month),
    itemCount: itemRows.filter((item) => normalizeDateKey(item.monthKey) === monthStart).length,
    monthEnd,
    monthStart,
    staffCount: staffRows.length,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseExportInput(body);

    if (!parsed) {
      return NextResponse.json({ error: 'Valid year and month are required' }, { status: 400 });
    }

    const actor = await getAuditActor();
    const result = await buildOffenceBookExportWorkbook(parsed);

    await tryWriteAuditEvent({
      entityType: 'export',
      entityId: `offence-book-${parsed.year}-${parsed.month + 1}`,
      action: 'GENERATE',
      before: null,
      after: {
        fileName: result.fileName,
        itemCount: result.itemCount,
        month: parsed.month + 1,
        monthEnd: result.monthEnd,
        monthStart: result.monthStart,
        staffCount: result.staffCount,
        year: parsed.year,
      },
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'offence-book-export',
    });

    return new NextResponse(result.buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error) {
    console.error('OFFENCE BOOK export failed:', error);
    const message = error instanceof Error ? error.message : 'OFFENCE BOOK export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
