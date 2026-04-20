// app/api/calendar/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar, auditEvent } from '@/db/schema';
import { fetchGhanaHolidaysForYear } from '@/lib/google-calendar';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { currentUser } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const years = body.years || [body.year || new Date().getFullYear()];

    let totalAdded = 0;
    let totalSkipped = 0;
    let totalUpdated = 0;

    for (const year of years) {
      // Fetch holidays from Google Calendar for this year
      const googleHolidays = await fetchGhanaHolidaysForYear(year);

      if (googleHolidays.length === 0) {
        continue;
      }

      let added = 0;
      let skipped = 0;
      let updated = 0;

      for (const holiday of googleHolidays) {
        // Check if this date already exists
        const existing = await db.query.workCalendar.findFirst({
          where: (cal, { eq }) => eq(cal.date, holiday.date),
        });

        if (existing) {
          // User manually removed this holiday → skip it
          if (existing.isRemoved) {
            skipped++;
            continue;
          }

          // User manually added this date (not from Google) → skip it
          if (existing.source === 'manual') {
            skipped++;
            continue;
          }

          // Google-sourced holiday: update name if changed
          if (existing.holidayNote !== holiday.name) {
            await db.update(workCalendar)
              .set({
                holidayNote: holiday.name,
                updatedAt: new Date(),
              })
              .where(eq(workCalendar.id, existing.id));
            updated++;
          }

          skipped++;
        } else {
          // Add new holiday from Google
          await db.insert(workCalendar).values({
            date: holiday.date,
            isHoliday: true,
            holidayNote: holiday.name,
            source: 'google',
            isRemoved: false,
          });

          added++;
        }
      }

      totalAdded += added;
      totalSkipped += skipped;
      totalUpdated += updated;
    }

    if (totalAdded > 0 || totalUpdated > 0) {
      publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });
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

    // Audit log for bulk sync (summary entry)
    if (totalAdded > 0) {
      await db.insert(auditEvent).values({
        entityType: 'calendar',
        entityId: `sync-${Date.now()}`,
        action: 'CREATE',
        beforeJson: null,
        afterJson: { years, totalAdded, totalUpdated, totalSkipped },
        actorUserId,
        actorEmail,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Added ${totalAdded}, updated ${totalUpdated}, skipped ${totalSkipped} across ${years.length} year${years.length > 1 ? 's' : ''}.`,
      synced: totalAdded,
      years,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to sync holidays:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to sync holidays'
    }, { status: 500 });
  }
}

// GET - Return sync status only
export async function GET() {
  try {
    const lastSync = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.source, 'google'),
      orderBy: (cal, { desc }) => [desc(cal.updatedAt)],
    });

    return NextResponse.json({
      lastSyncedAt: lastSync?.updatedAt?.toISOString() || null,
    });
  } catch (error) {
    return NextResponse.json({ lastSyncedAt: null });
  }
}
