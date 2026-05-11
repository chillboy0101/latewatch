import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { latenessEntry, staff } from '@/db/schema';
import {
  createDailyWhatsAppQueue,
  createWeeklyWhatsAppQueue,
} from '@/lib/whatsapp-notices';

export const dynamic = 'force-dynamic';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null) {
  return value && DATE_PATTERN.test(value) ? value : null;
}

async function getRowsForRange(start: string, end: string) {
  return db.select({
    computedAmount: latenessEntry.computedAmount,
    date: latenessEntry.date,
    staffId: latenessEntry.staffId,
    staffName: staff.fullName,
    whatsappNotificationsEnabled: staff.whatsappNotificationsEnabled,
    whatsappPhone: staff.whatsappPhone,
  })
    .from(latenessEntry)
    .leftJoin(staff, eq(latenessEntry.staffId, staff.id))
    .where(and(gte(latenessEntry.date, start), lte(latenessEntry.date, end)));
}

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type');

    if (type === 'daily') {
      const date = validDate(request.nextUrl.searchParams.get('date'));
      if (!date) {
        return NextResponse.json({ error: 'Valid date is required' }, { status: 400 });
      }

      const rows = await getRowsForRange(date, date);
      return NextResponse.json({
        date,
        notices: createDailyWhatsAppQueue({ date, rows }),
        type,
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (type === 'weekly') {
      const weekStart = validDate(request.nextUrl.searchParams.get('weekStart'));
      const weekEnd = validDate(request.nextUrl.searchParams.get('weekEnd'));
      if (!weekStart || !weekEnd || weekStart > weekEnd) {
        return NextResponse.json({ error: 'Valid weekStart and weekEnd are required' }, { status: 400 });
      }

      const rows = await getRowsForRange(weekStart, weekEnd);
      return NextResponse.json({
        notices: createWeeklyWhatsAppQueue({ rows, weekEnd, weekStart }),
        type,
        weekEnd,
        weekStart,
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return NextResponse.json({ error: 'type must be daily or weekly' }, { status: 400 });
  } catch (error) {
    console.error('Failed to build WhatsApp queue:', error);
    return NextResponse.json({ error: 'Failed to build WhatsApp queue' }, { status: 500 });
  }
}
