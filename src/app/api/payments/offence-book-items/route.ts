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

function parseYearMonth(url: URL) {
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;

  return {
    month,
    monthKey: `${year}-${String(month + 1).padStart(2, '0')}-01`,
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
    monthKey: `${year}-${String(month + 1).padStart(2, '0')}-01`,
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

function normalizeItems(value: unknown, itemType: OffenceBookItemType) {
  const rows = Array.isArray(value) ? value : [];
  const limit = OFFENCE_BOOK_ITEM_LIMITS[itemType];

  if (rows.length > limit) {
    throw new Error(`${itemType === 'external_money' ? 'External money' : 'Expenditure'} supports up to ${limit} rows`);
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
    .filter((item): item is { amount: string; displayOrder: number; itemType: OffenceBookItemType; label: string } => Boolean(item));
}

function groupItems(rows: Array<typeof offenceBookItem.$inferSelect>) {
  return {
    expenditure: rows.filter((row) => row.itemType === 'expenditure'),
    externalMoney: rows.filter((row) => row.itemType === 'external_money'),
  };
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

    return NextResponse.json({
      ...groupItems(rows),
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
    const before = await db.select()
      .from(offenceBookItem)
      .where(eq(offenceBookItem.monthKey, parsed.monthKey));
    const email = actorEmail(user);

    await db.delete(offenceBookItem)
      .where(and(
        eq(offenceBookItem.monthKey, parsed.monthKey),
      ));

    const values = [...externalMoney, ...expenditure].map((item) => ({
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
      ...groupItems(rows),
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
