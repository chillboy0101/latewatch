// app/api/calendar/sync/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { fetchGhanaHolidaysForYear } from '@/lib/google-calendar';
import { eq } from 'drizzle-orm';

export async function POST() {
  try {
    const currentYear = new Date().getFullYear();
    
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

    for (const holiday of googleHolidays) {
      // Check if this date already exists
      const existing = await db.query.workCalendar.findFirst({
        where: (cal, { eq }) => eq(cal.date, holiday.date),
      });

      if (existing) {
        // If user manually removed this holiday, don't re-add it
        if (existing.isRemoved) {
          skipped++;
          continue;
        }

        // If user manually changed it, preserve their changes
        if (existing.source === 'manual') {
          skipped++;
          continue;
        }

        // Update existing Google-sourced holiday (name may have changed)
        await db.update(workCalendar)
          .set({
            isHoliday: true,
            holidayNote: holiday.name,
            source: 'google',
            isRemoved: false,
            updatedAt: new Date(),
          })
          .where(eq(workCalendar.id, existing.id));
        
        skipped++; // Counted as updated, not added
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
      message: `Synced ${added} new holidays, ${skipped} updated/skipped.`,
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

// GET endpoint for auto-sync on page load
export async function GET() {
  try {
    const currentYear = new Date().getFullYear();
    const googleHolidays = await fetchGhanaHolidaysForYear(currentYear);
    
    if (googleHolidays.length === 0) {
      return NextResponse.json({ 
        synced: false, 
        message: 'No API key or failed to fetch',
        lastSyncedAt: null,
      });
    }

    let added = 0;
    for (const holiday of googleHolidays) {
      const existing = await db.query.workCalendar.findFirst({
        where: (cal, { eq }) => eq(cal.date, holiday.date),
      });

      if (!existing) {
        await db.insert(workCalendar).values({
          date: holiday.date,
          isHoliday: true,
          holidayNote: holiday.name,
          source: 'google',
          isRemoved: false,
        });
        added++;
      } else if (existing.source === 'google' && !existing.isRemoved) {
        // Update name if changed from Google
        if (existing.holidayNote !== holiday.name) {
          await db.update(workCalendar)
            .set({ holidayNote: holiday.name, updatedAt: new Date() })
            .where(eq(workCalendar.id, existing.id));
        }
      }
    }

    const lastSync = await db.query.workCalendar.findFirst({
      where: (cal, { eq }) => eq(cal.source, 'google'),
      orderBy: (cal, { desc }) => [desc(cal.updatedAt)],
    });

    return NextResponse.json({ 
      synced: true, 
      added,
      lastSyncedAt: lastSync?.updatedAt?.toISOString() || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Auto-sync failed:', error);
    return NextResponse.json({ 
      synced: false, 
      error: 'Auto-sync failed' 
    }, { status: 500 });
  }
}
