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
        // Add new holiday from Google (including past dates for completeness)
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
