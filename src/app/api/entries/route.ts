// app/api/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, workCalendar, staff, auditEvent } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { currentUser } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    // Single date query
    if (date) {
      const entries = await db.select({
        id: latenessEntry.id,
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        didNotSignOut: latenessEntry.didNotSignOut,
        reason: latenessEntry.reason,
        computedAmount: latenessEntry.computedAmount,
        createdAt: latenessEntry.createdAt,
      })
      .from(latenessEntry)
      .where(eq(latenessEntry.date, date));
      return NextResponse.json(entries, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      });
    }

    // Date range query (for exports/performance)
    if (start && end) {
      const entries = await db.select({
        id: latenessEntry.id,
        staffId: latenessEntry.staffId,
        date: latenessEntry.date,
        arrivalTime: latenessEntry.arrivalTime,
        didNotSignOut: latenessEntry.didNotSignOut,
        reason: latenessEntry.reason,
        computedAmount: latenessEntry.computedAmount,
        createdAt: latenessEntry.createdAt,
      })
      .from(latenessEntry)
      .where(and(gte(latenessEntry.date, start), lte(latenessEntry.date, end)));
      return NextResponse.json(entries, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      });
    }

    return NextResponse.json({ error: 'Date or start/end parameters required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to fetch entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get current user for audit logging (optional — we still allow the save even if it fails)
    let actorEmail = 'system';
    let actorUserId: string | undefined = undefined;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch {
      // continue without auth info
    }

    const body = await request.json();
    const { date, entries } = body;

    if (!date || !Array.isArray(entries)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Check if the date is a holiday
    const [holidayCheck] = await db.select()
      .from(workCalendar)
      .where(and(eq(workCalendar.date, date), eq(workCalendar.isHoliday, true)));

    if (holidayCheck) {
      return NextResponse.json(
        { error: `Cannot create entries for ${date} - it is marked as a holiday (${holidayCheck.holidayNote || 'Holiday'})` },
        { status: 400 }
      );
    }

    // Fetch staff names for audit logging
    const staffList = await db.select({ id: staff.id, fullName: staff.fullName }).from(staff);
    const staffMap = new Map(staffList.map(s => [s.id, s.fullName]));

    const results = [];

    for (const entry of entries) {
      const [existing] = await db.select()
        .from(latenessEntry)
        .where(and(eq(latenessEntry.staffId, entry.staffId), eq(latenessEntry.date, date)));

      let result;
      if (existing) {
        const before = { ...existing };
        [result] = await db.update(latenessEntry)
          .set({
            arrivalTime: entry.arrivalTime || null,
            didNotSignOut: entry.didNotSignOut,
            computedAmount: entry.amount.toString(),
            reason: entry.reason,
            updatedAt: new Date(),
          })
          .where(eq(latenessEntry.id, existing.id))
          .returning();

        // Audit log for update
        await db.insert(auditEvent).values({
          entityType: 'entry',
          entityId: result.id,
          action: 'UPDATE',
          beforeJson: before,
          afterJson: {
            ...result,
            staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
          },
          actorUserId: actorUserId ?? null,
          actorEmail,
        });
      } else {
        [result] = await db.insert(latenessEntry).values({
          staffId: entry.staffId,
          date: date,
          arrivalTime: entry.arrivalTime || null,
          didNotSignOut: entry.didNotSignOut,
          computedAmount: entry.amount.toString(),
          reason: entry.reason,
        }).returning();

        // Audit log for create
        await db.insert(auditEvent).values({
          entityType: 'entry',
          entityId: result.id,
          action: 'CREATE',
          beforeJson: null,
          afterJson: {
            ...result,
            staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
          },
          actorUserId: actorUserId ?? null,
          actorEmail,
        });
      }

      results.push(result);
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'entries' });

    return NextResponse.json({ success: true, count: results.length });
  } catch (error) {
    console.error('Failed to save entries:', error);
    return NextResponse.json({ error: 'Failed to save entries' }, { status: 500 });
  }
}
