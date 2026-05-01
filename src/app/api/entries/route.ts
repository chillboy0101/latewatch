// app/api/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { entrySubmission, latenessEntry, workCalendar, staff } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { getAuditActor, writeAuditEvent } from '@/lib/audit';
import { computePenalty } from '@/lib/penalty-calculator';

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
          'Cache-Control': 'no-store',
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
          'Cache-Control': 'no-store',
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
    const body = await request.json();
    const { date, entries } = body;

    if (!date || !Array.isArray(entries)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const selectedDate = new Date(`${date}T00:00:00`);
    if (selectedDate.getDay() === 0 || selectedDate.getDay() === 6) {
      return NextResponse.json(
        { error: 'Cannot create entries for weekends' },
        { status: 400 },
      );
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

    // Active staff can receive new entries. Existing date entries remain editable so historical corrections work.
    const staffList = await db.select({
      id: staff.id,
      fullName: staff.fullName,
      active: staff.active,
      archived: staff.archived,
    }).from(staff);
    const staffMap = new Map(staffList.map(s => [s.id, s.fullName]));
    const activeStaffIds = new Set(
      staffList
        .filter((s) => s.active === true && s.archived !== true)
        .map((s) => s.id),
    );
    const existingEntries = await db.select()
      .from(latenessEntry)
      .where(eq(latenessEntry.date, date));
    const existingByStaffId = new Map(existingEntries.map((entry) => [entry.staffId, entry]));
    const existingEntryStaffIds = new Set(existingEntries.map((entry) => entry.staffId));
    const allowedStaffIds = new Set([...activeStaffIds, ...existingEntryStaffIds]);

    const results = [];
    let deletedCount = 0;

    for (const entry of entries) {
      if (!entry || typeof entry.staffId !== 'string' || !allowedStaffIds.has(entry.staffId)) {
        continue;
      }

      const arrivalTime = typeof entry.arrivalTime === 'string' && /^\d{2}:\d{2}$/.test(entry.arrivalTime)
        ? entry.arrivalTime
        : null;
      const didNotSignOut = entry.didNotSignOut === true;
      const penalty = computePenalty({
        arrivalTime,
        didNotSignOut,
        isHoliday: false,
      });

      const existing = existingByStaffId.get(entry.staffId);
      const shouldStoreEntry = didNotSignOut || penalty.amount > 0;

      if (!shouldStoreEntry) {
        if (existing) {
          await db.delete(latenessEntry).where(eq(latenessEntry.id, existing.id));
          await writeAuditEvent({
            entityType: 'entry',
            entityId: existing.id,
            action: 'DELETE',
            before: {
              ...existing,
              staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
            },
            after: null,
            reason: 'entries',
          });
          deletedCount += 1;
        }
        continue;
      }

      let result;
      if (existing) {
        const before = { ...existing };
        [result] = await db.update(latenessEntry)
          .set({
            arrivalTime,
            didNotSignOut,
            computedAmount: penalty.amount.toString(),
            reason: penalty.reason,
            updatedAt: new Date(),
          })
          .where(eq(latenessEntry.id, existing.id))
          .returning();

        await writeAuditEvent({
          entityType: 'entry',
          entityId: result.id,
          action: 'UPDATE',
          before,
          after: {
            ...result,
            staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
          },
          reason: 'entries',
        });
      } else {
        [result] = await db.insert(latenessEntry).values({
          staffId: entry.staffId,
          date: date,
          arrivalTime,
          didNotSignOut,
          computedAmount: penalty.amount.toString(),
          reason: penalty.reason,
        }).returning();

        await writeAuditEvent({
          entityType: 'entry',
          entityId: result.id,
          action: 'CREATE',
          before: null,
          after: {
            ...result,
            staff: { fullName: staffMap.get(entry.staffId) || 'Unknown' },
          },
          reason: 'entries',
        });
      }

      results.push(result);
    }

    const actor = await getAuditActor();
    const [existingSubmission] = await db.select()
      .from(entrySubmission)
      .where(eq(entrySubmission.date, date))
      .limit(1);
    const now = new Date();
    const [submission] = await db.insert(entrySubmission)
      .values({
        date,
        submittedByUserId: actor.actorUserId,
        submittedByEmail: actor.actorEmail,
        entryCount: results.length,
        deletedCount,
        submittedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: entrySubmission.date,
        set: {
          submittedByUserId: actor.actorUserId,
          submittedByEmail: actor.actorEmail,
          entryCount: results.length,
          deletedCount,
          submittedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await writeAuditEvent({
      entityType: 'entry_submission',
      entityId: date,
      action: existingSubmission ? 'UPDATE' : 'CREATE',
      before: existingSubmission || null,
      after: submission,
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      reason: 'entries',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'entries' });

    return NextResponse.json({
      success: true,
      count: results.length,
      deletedCount,
      submittedAt: submission?.submittedAt,
    });
  } catch (error) {
    console.error('Failed to save entries:', error);
    return NextResponse.json({ error: 'Failed to save entries' }, { status: 500 });
  }
}
