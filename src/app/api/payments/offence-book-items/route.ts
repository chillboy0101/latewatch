import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPaymentAllocation, offenceBookItem, staff } from '@/db/schema';
import { getAccraClock } from '@/lib/attendance';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { writeAuditEvent } from '@/lib/audit';
import {
  calculateOffenceBookFinancialSummary,
  OFFENCE_BOOK_ITEM_LIMITS,
  type OffenceBookItemInput,
  type OffenceBookItemType,
} from '@/lib/offence-book-export';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const PAYMENT_SYNC_START_DATE = '2000-01-01';

type EditableItem = {
  amount?: unknown;
  label?: unknown;
};

type OffenceBookBalanceItemType = Extract<OffenceBookItemType, 'opening_balance'>;
type OffenceBookListItemType = Exclude<OffenceBookItemType, 'opening_balance' | 'closing_balance'>;

function formatMonthKey(year: number, month: number) {
  const normalized = new Date(year, month, 1);
  return `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, '0')}-01`;
}

function isFutureMonth(monthKey: string) {
  const clock = getAccraClock();
  const [currentYear, currentMonth] = clock.dateKey.split('-').map(Number);
  const currentMonthKey = formatMonthKey(currentYear, currentMonth - 1);

  return monthKey > currentMonthKey;
}


function formatDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function normalizeDateKey(value: string | Date) {
  return value instanceof Date ? formatDateKey(value) : value.slice(0, 10);
}

function parseYearMonth(url: URL) {
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;

  return {
    month,
    monthKey: formatMonthKey(year, month),
    year,
  };
}

function parseBodyMonth(body: unknown) {
  const year = Number((body as { year?: unknown })?.year);
  const month = Number((body as { month?: unknown })?.month);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;

  return {
    month,
    monthKey: formatMonthKey(year, month),
    year,
  };
}

function amountString(value: unknown) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amounts must be zero or greater');
  }

  return amount.toFixed(2);
}

function itemTypeLabel(itemType: OffenceBookListItemType) {
  return itemType === 'external_money' ? 'External money' : 'Expenditure';
}

function normalizeItems(value: unknown, itemType: OffenceBookListItemType) {
  const rows = Array.isArray(value) ? value : [];
  const limit = OFFENCE_BOOK_ITEM_LIMITS[itemType];

  if (rows.length > limit) {
    throw new Error(`${itemTypeLabel(itemType)} supports up to ${limit} rows`);
  }

  return rows
    .map((row, index) => {
      const item = row as EditableItem;
      const label = typeof item?.label === 'string' ? item.label.trim().slice(0, 160) : '';
      const amount = amountString(item?.amount);
      const hasContent = label || Number(amount) > 0;

      if (!hasContent) return null;
      if (!label) throw new Error('Every offence book item needs a label or source');

      return {
        amount,
        displayOrder: index + 1,
        itemType,
        label,
      };
    })
    .filter((item): item is { amount: string; displayOrder: number; itemType: OffenceBookListItemType; label: string } => Boolean(item));
}

function normalizeBalance(value: unknown, itemType: OffenceBookBalanceItemType) {
  if (value === undefined || value === null || value === '') return null;
  const amount = amountString(value);

  return {
    amount,
    displayOrder: 0,
    itemType,
    label: 'Opening balance',
  };
}

function groupItems(
  rows: Array<typeof offenceBookItem.$inferSelect>,
  carriedOpeningBalance = '',
  calculatedClosingBalance = '',
) {
  const openingBalance = rows.find((row) => row.itemType === 'opening_balance')?.amount || '';

  return {
    calculatedClosingBalance,
    carriedOpeningBalance,
    closingBalance: calculatedClosingBalance,
    expenditure: rows.filter((row) => row.itemType === 'expenditure'),
    externalMoney: rows.filter((row) => row.itemType === 'external_money'),
    openingBalance,
  };
}

function currentMonthRows(rows: Array<typeof offenceBookItem.$inferSelect>, monthKey: string) {
  return rows.filter((row) => normalizeDateKey(row.monthKey) === monthKey);
}

async function loadOffenceBookItemsThroughMonth(monthKey: string) {
  return db.select()
    .from(offenceBookItem)
    .where(lte(offenceBookItem.monthKey, monthKey))
    .orderBy(asc(offenceBookItem.monthKey), asc(offenceBookItem.itemType), asc(offenceBookItem.displayOrder));
}

/**
 * Only the ledger's very first tracked month may hold a manual opening-balance
 * anchor - every later month must inherit the previous month's live closing
 * balance so the two can never drift apart again. A month qualifies as
 * "first" only if no anchor has ever been saved for an earlier month.
 */
async function hasOpeningBalanceAnchorBefore(monthKey: string) {
  const rows = await db.select({ id: offenceBookItem.id })
    .from(offenceBookItem)
    .where(and(eq(offenceBookItem.itemType, 'opening_balance'), lt(offenceBookItem.monthKey, monthKey)))
    .limit(1);

  return rows.length > 0;
}

async function loadFinancialSummary(input: { month: number; monthKey: string; year: number }, itemRows: Array<typeof offenceBookItem.$inferSelect>) {
  const monthEnd = formatDateKey(new Date(input.year, input.month + 1, 0));

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

  const allocations = allocationRows;
  const entries = entryRows.map((entry) => ({
    ...entry,
    date: normalizeDateKey(entry.date),
  }));
  const items = itemRows.map((item) => ({
    amount: item.amount,
    displayOrder: item.displayOrder,
    itemType: item.itemType as OffenceBookItemInput['itemType'],
    label: item.label,
    monthKey: normalizeDateKey(item.monthKey),
  }));

  const summary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items,
    month: input.month,
    staff: staffRows,
    year: input.year,
  });
  const previousMonth = new Date(input.year, input.month - 1, 1);
  const carriedSummary = calculateOffenceBookFinancialSummary({
    allocations,
    entries,
    items,
    month: previousMonth.getMonth(),
    staff: staffRows,
    year: previousMonth.getFullYear(),
  });

  return { carriedOpeningBalance: carriedSummary.calculatedClosingBalance, summary };
}

function actorEmail(user: Awaited<ReturnType<typeof currentUser>>) {
  return user?.primaryEmailAddress?.emailAddress
    || user?.emailAddresses[0]?.emailAddress
    || 'system';
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parsed = parseYearMonth(new URL(request.url));
    if (!parsed) {
      return NextResponse.json({ error: 'Valid year and month are required' }, { status: 400 });
    }

    if (isFutureMonth(parsed.monthKey)) {
      return NextResponse.json({
        ...groupItems([], '', '0.00'),
        canEditOpeningBalance: true,
        month: parsed.month,
        monthKey: parsed.monthKey,
        year: parsed.year,
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const itemRows = await loadOffenceBookItemsThroughMonth(parsed.monthKey);
    const rows = currentMonthRows(itemRows, parsed.monthKey);
    const { carriedOpeningBalance, summary } = await loadFinancialSummary(parsed, itemRows);
    const canEditOpeningBalance = !(await hasOpeningBalanceAnchorBefore(parsed.monthKey));

    return NextResponse.json({
      ...groupItems(rows, carriedOpeningBalance, summary.calculatedClosingBalance),
      canEditOpeningBalance,
      month: parsed.month,
      monthKey: parsed.monthKey,
      year: parsed.year,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load offence book items:', error);
    return NextResponse.json({ error: 'Failed to load offence book items' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = parseBodyMonth(body);
    if (!parsed) {
      return NextResponse.json({ error: 'Valid year and month are required' }, { status: 400 });
    }

    if (isFutureMonth(parsed.monthKey)) {
      return NextResponse.json({ error: 'Cannot record offence book entries for a future month' }, { status: 400 });
    }

    const externalMoney = normalizeItems((body as { externalMoney?: unknown })?.externalMoney, 'external_money');
    const expenditure = normalizeItems((body as { expenditure?: unknown })?.expenditure, 'expenditure');
    const canEditOpeningBalance = !(await hasOpeningBalanceAnchorBefore(parsed.monthKey));
    const openingBalance = canEditOpeningBalance
      ? normalizeBalance((body as { openingBalance?: unknown })?.openingBalance, 'opening_balance')
      : null;
    const before = await db.select()
      .from(offenceBookItem)
      .where(eq(offenceBookItem.monthKey, parsed.monthKey));
    const email = actorEmail(user);

    await db.delete(offenceBookItem)
      .where(and(
        eq(offenceBookItem.monthKey, parsed.monthKey),
      ));

    const values = [
      ...(openingBalance ? [openingBalance] : []),
      ...externalMoney,
      ...expenditure,
    ].map((item) => ({
      ...item,
      createdByEmail: email,
      monthKey: parsed.monthKey,
      updatedAt: new Date(),
      updatedByEmail: email,
    }));

    if (values.length > 0) {
      await db.insert(offenceBookItem).values(values);
    }

    const itemRows = await loadOffenceBookItemsThroughMonth(parsed.monthKey);
    const rows = currentMonthRows(itemRows, parsed.monthKey);
    const { carriedOpeningBalance, summary } = await loadFinancialSummary(parsed, itemRows);

    await writeAuditEvent({
      entityType: 'offence_book_item',
      entityId: parsed.monthKey,
      action: 'UPDATE',
      before,
      after: rows,
      actor: { email, id: user.id },
      publish: false,
      reason: 'offence-book-items',
    });

    publishRealtime('payments', 'invalidate', {
      month: parsed.month,
      reason: 'offence-book-items',
      year: parsed.year,
    });

    return NextResponse.json({
      ...groupItems(rows, carriedOpeningBalance, summary.calculatedClosingBalance),
      canEditOpeningBalance,
      month: parsed.month,
      monthKey: parsed.monthKey,
      success: true,
      year: parsed.year,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save offence book items';
    console.error('Failed to save offence book items:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
