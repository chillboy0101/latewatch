// lib/google-calendar.ts
import { google } from 'googleapis';

// Ghana public holidays calendar ID (official Google calendar)
const GHANA_HOLIDAYS_CALENDAR_ID = 'en.gh#holiday@group.v.calendar.google.com';

interface GoogleCalendarEvent {
  summary: string;
  start: { date: string };
  end: { date: string };
}

export interface GhanaHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  source: 'google';
}

export async function fetchGhanaHolidays(
  year?: number,
  month?: number
): Promise<GhanaHoliday[]> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;

  if (!apiKey) {
    console.warn('GOOGLE_CALENDAR_API_KEY not set. Skipping Google Calendar sync.');
    return [];
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: apiKey });

    // Build date range
    let timeMin: string;
    let timeMax: string;

    if (year !== undefined && month !== undefined) {
      // Specific month
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      timeMin = startDate.toISOString();
      timeMax = endDate.toISOString();
    } else if (year !== undefined) {
      // Specific year
      timeMin = new Date(year, 0, 1).toISOString();
      timeMax = new Date(year, 11, 31, 23, 59, 59).toISOString();
    } else {
      // Default: current year
      const now = new Date();
      timeMin = new Date(now.getFullYear(), 0, 1).toISOString();
      timeMax = new Date(now.getFullYear(), 11, 31, 23, 59, 59).toISOString();
    }

    const response = await calendar.events.list({
      calendarId: GHANA_HOLIDAYS_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    return events
      .filter((event): event is GoogleCalendarEvent =>
        !!(event.summary && event.start?.date)
      )
      .map((event) => ({
        date: event.start.date,
        name: event.summary,
        source: 'google' as const,
      }));
  } catch (error) {
    console.error('Failed to fetch Ghana holidays from Google Calendar:', error);
    return [];
  }
}

export async function fetchGhanaHolidaysForYear(year: number): Promise<GhanaHoliday[]> {
  return fetchGhanaHolidays(year);
}

export async function fetchGhanaHolidaysForMonth(
  year: number,
  month: number
): Promise<GhanaHoliday[]> {
  return fetchGhanaHolidays(year, month);
}

/**
 * Sync multiple years at once (previous, current, next).
 * Returns results per year.
 */
export async function fetchGhanaHolidaysForYears(years: number[]): Promise<Map<number, GhanaHoliday[]>> {
  const results = new Map<number, GhanaHoliday[]>();
  await Promise.all(
    years.map(async (year) => {
      const holidays = await fetchGhanaHolidaysForYear(year);
      results.set(year, holidays);
    })
  );
  return results;
}
