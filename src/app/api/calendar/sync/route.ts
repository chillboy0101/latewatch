// app/api/calendar/sync/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { fetchGhanaHolidaysForYear } from '@/lib/google-calendar';
import { eq } from 'drizzle-orm';
import { format } from 'date-fns';

export async function POST() {
  try {
    const currentYear = new Date().getFullYear();
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // Fetch holidays from Google Calendar for current year
    const googleHolidays = await fetchGhanaHolidaysForYear(currentYear);
    
    if (googleHolidays.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'No holidays fetched. Check GOOGLE_CALENDAR_API_KEY.',
        synced: 0 
      });
    }

    let added = 0;
    let skipped = 0;
    let updated = 0;

    for (const holiday of googleHolidays) {
      // Skip holidays that have already passed - preserve historical data
      if (holiday.date < today) {
        skipped++;
        continue;
      }

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

    return NextResponse.json({ 
      success: true, 
      message: `Added ${added}, updated ${updated}, skipped ${skipped}.`,
      synced: added,
      total: googleHolidays.length,
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

// GET endpoint for auto-sync on calendar page visit
export async function GET() {
  try {
    // Check last sync time
    const lastSync = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.source, 'google'),
      orderBy: (cal, { desc }) => [desc(cal.updatedAt)],
    });

    const lastSyncedAt = lastSync?.updatedAt;
    const now = new Date();
    const hoursSinceLastSync = lastSyncedAt 
      ? (now.getTime() - new Date(lastSyncedAt).getTime()) / (1000 * 60 * 60)
      : 999;

    // Only sync if >24 hours since last sync
    if (hoursSinceLastSync < 24) {
      return NextResponse.json({ 
        synced: false, 
        message: 'Already up to date',
        lastSyncedAt: lastSyncedAt?.toISOString() || null,
      });
    }

    const currentYear = new Date().getFullYear();
    const today = format(now, 'yyyy-MM-dd');
    const googleHolidays = await fetchGhanaHolidaysForYear(currentYear);
    
    if (googleHolidays.length === 0) {
      return NextResponse.json({ 
        synced: false, 
        message: 'No API key or failed to fetch',
        lastSyncedAt: lastSyncedAt?.toISOString() || null,
      });
    }

    let added = 0;
    let updated = 0;
    
    for (const holiday of googleHolidays) {
      // Skip holidays that have already passed - preserve historical data
      if (holiday.date < today) {
        continue;
      }

      const existing = await db.query.workCalendar.findFirst({
        where: (cal, { eq }) => eq(cal.date, holiday.date),
      });

      if (!existing) {
        // Add new future holiday
        await db.insert(workCalendar).values({
          date: holiday.date,
          isHoliday: true,
          holidayNote: holiday.name,
          source: 'google',
          isRemoved: false,
        });
        added++;
      } else if (existing.source === 'google' && !existing.isRemoved) {
        // Only update future holidays name if changed
        if (existing.holidayNote !== holiday.name) {
          await db.update(workCalendar)
            .set({ holidayNote: holiday.name, updatedAt: new Date() })
            .where(eq(workCalendar.id, existing.id));
          updated++;
        }
      }
    }

    // Get fresh last sync time
    const freshSync = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.source, 'google'),
      orderBy: (cal, { desc }) => [desc(cal.updatedAt)],
    });

    return NextResponse.json({ 
      synced: true, 
      added,
      updated,
      lastSyncedAt: freshSync?.updatedAt?.toISOString() || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Auto-sync failed:', error);
    return NextResponse.json({ 
      synced: false, 
      error: 'Auto-sync failed' 
    }, { status: 500 });
  }
}
