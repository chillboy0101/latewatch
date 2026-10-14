// lib/google-calendar.ts
import { applyGhanaHolidayOverrides } from '@/lib/ghana-holidays';

// Google's public "Holidays in Ghana" calendar as an iCal feed. It needs no API key.
export const GHANA_HOLIDAYS_FEED_URL =
  'https://calendar.google.com/calendar/ical/en.gh%23holiday%40group.v.calendar.google.com/public/basic.ics';

export interface GhanaHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  source: 'google';
}

export type HolidayFeedEvent = {
  date: string;
  name: string;
  /** Google labels each day "Public holiday" or "Observance"; only public holidays close the office. */
  observance: boolean;
};

function unescapeIcalText(value: string) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** Reads the all-day events of an iCal feed (folded lines and escaped text handled). */
export function parseHolidayFeed(ics: string): HolidayFeedEvent[] {
  // Lines that start with a space or tab continue the previous line.
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: HolidayFeedEvent[] = [];
  let current: { date?: string; description?: string; name?: string } | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.date && current.name) {
        events.push({
          date: current.date,
          name: current.name,
          observance: /^observance/i.test(current.description || ''),
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).split(';')[0].toUpperCase();
    const value = line.slice(separator + 1);

    if (key === 'DTSTART') {
      const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
      if (match) current.date = `${match[1]}-${match[2]}-${match[3]}`;
    } else if (key === 'SUMMARY') {
      current.name = unescapeIcalText(value);
    } else if (key === 'DESCRIPTION') {
      current.description = unescapeIcalText(value);
    }
  }

  return events.sort((left, right) => left.date.localeCompare(right.date));
}

/** The whole public feed (it spans about a year either side of today). Throws if Google can't be reached. */
export async function fetchGhanaHolidayFeed(): Promise<HolidayFeedEvent[]> {
  const response = await fetch(GHANA_HOLIDAYS_FEED_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Holiday feed returned ${response.status}`);
  return parseHolidayFeed(await response.text());
}

/** Public holidays (observances left out) for a year or one month, with the Ghana overrides applied. */
export function publicHolidaysFrom(events: HolidayFeedEvent[], year: number, month?: number): GhanaHoliday[] {
  const prefix = month === undefined ? `${year}-` : `${year}-${String(month + 1).padStart(2, '0')}-`;
  return applyGhanaHolidayOverrides(
    events
      .filter((event) => !event.observance && event.date.startsWith(prefix))
      .map((event) => ({ date: event.date, name: event.name, source: 'google' as const })),
    { month, year },
  );
}

export async function fetchGhanaHolidays(year?: number, month?: number): Promise<GhanaHoliday[]> {
  try {
    return publicHolidaysFrom(await fetchGhanaHolidayFeed(), year ?? new Date().getFullYear(), month);
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
  const events = await fetchGhanaHolidayFeed().catch((error) => {
    console.error('Failed to fetch Ghana holidays from Google Calendar:', error);
    return [] as HolidayFeedEvent[];
  });
  for (const year of years) results.set(year, publicHolidaysFrom(events, year));
  return results;
}
