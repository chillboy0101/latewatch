import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { offenceBookItem } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { OFFENCE_BOOK_ITEM_LIMITS, type OffenceBookItemType } from '@/lib/offence-book-export';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

type EditableItem = {
  amount?: unknown;
  label?: unknown;
};

type OffenceBookBalanceItemType = Extract<OffenceBookItemType, 'opening_balance' | 'closing_balance'>;
type OffenceBookListItemType = Exclude<OffenceBookItemType, OffenceBookBalanceItemType>;

function formatMonthKey(year: number, month: number) {
  const normalized = new Date(year, month, 1);
  return `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, '0')}-01`;
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

  return {
    amount: amountString(value),
    displayOrder: 0,
    itemType,
    label: itemType === 'opening_balance' ? 'Opening balance' : 'Closing balance',
  };
}

function groupItems(rows: Array<typeof offenceBookItem.$inferSelect>, carriedOpeningBalance = '') {
  const openingBalance = rows.find((row) => row.itemType === 'opening_balance')?.amount || '';
  const closingBalance = rows.find((row) => row.itemType === 'closing_balance')?.amount || '';

  return {
    carriedOpeningBalance,
    closingBalance,
    expenditure: rows.filter((row) => row.itemType === 'expenditure'),
    externalMoney: rows.filter((row) => row.itemType === 'external_money'),
    openingBalance,
  };
}

async function loadCarriedOpeningBalance(year: number, month: number) {
  const previousMonthKey = formatMonthKey(year, month - 1);
  const rows = await db.select({ amount: offenceBookItem.amount })
    .from(offenceBookItem)
    .where(and(
      eq(offenceBookItem.monthKey, previousMonthKey),
      eq(offenceBookItem.itemType, 'closing_balance'),
    ))
    .orderBy(asc(offenceBookItem.displayOrder))
    .limit(1);

  return rows[0]?.amount || '';
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

    const rows = await db.select()
      .from(offenceBookItem)
      .where(eq(offenceBookItem.monthKey, parsed.monthKey))
      .orderBy(asc(offenceBookItem.itemType), asc(offenceBookItem.displayOrder));
    const carriedOpeningBalance = await loadCarriedOpeningBalance(parsed.year, parsed.month);

    return NextResponse.json({
      ...groupItems(rows, carriedOpeningBalance),
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

    const externalMoney = normalizeItems((body as { externalMoney?: unknown })?.externalMoney, 'external_money');
    const expenditure = normalizeItems((body as { expenditure?: unknown })?.expenditure, 'expenditure');
    const openingBalance = normalizeBalance((body as { openingBalance?: unknown })?.openingBalance, 'opening_balance');
    const closingBalance = normalizeBalance((body as { closingBalance?: unknown })?.closingBalance, 'closing_balance');
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
      ...(closingBalance ? [closingBalance] : []),
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

    const rows = await db.select()
      .from(offenceBookItem)
      .where(eq(offenceBookItem.monthKey, parsed.monthKey))
      .orderBy(asc(offenceBookItem.itemType), asc(offenceBookItem.displayOrder));
    const carriedOpeningBalance = await loadCarriedOpeningBalance(parsed.year, parsed.month);

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
      ...groupItems(rows, carriedOpeningBalance),
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
