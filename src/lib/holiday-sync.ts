import 'server-only';

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/db';
import { workCalendar } from '@/db/schema';
import { tryWriteAuditEvent } from '@/lib/audit';
import { getAccraDateKey } from '@/lib/date-key';
import { getSuppressedGhanaHolidayDatesForScope } from '@/lib/ghana-holidays';
import { fetchGhanaHolidayFeed, publicHolidaysFrom } from '@/lib/google-calendar';
import { publishRealtime } from '@/lib/realtime';

type CalendarRow = { date: string; holidayNote: string | null; id: string; isHoliday: boolean | null; isRemoved: boolean | null; source: string | null };

export type HolidaySyncChange =
  | { action: 'add'; date: string; name: string }
  | { action: 'restore' | 'rename'; date: string; id: string; name: string }
  | { action: 'drop'; date: string; id: string; name: string | null };

/**
 * What a sync should change for one year. Only today and later are touched, so the days people
 * were (or weren't) charged for never change. Days an admin added or removed by hand are left
 * alone. A Google holiday the feed no longer lists (an observance, or a tentative Eid date that
 * moved) stops being a holiday, but only when the feed listed something for that year, so an
 * empty or broken feed can't wipe the calendar.
 */
export function planHolidaySync(input: {
  existing: CalendarRow[];
  holidays: Array<{ date: string; name: string }>;
  today: string;
}): HolidaySyncChange[] {
  const changes: HolidaySyncChange[] = [];
  if (input.holidays.length === 0) return changes;

  const existingByDate = new Map(input.existing.map((row) => [row.date.slice(0, 10), row]));
  const listed = new Set<string>();

  for (const holiday of input.holidays) {
    listed.add(holiday.date);
    if (holiday.date < input.today) continue;
    const row = existingByDate.get(holiday.date);
    if (!row) {
      changes.push({ action: 'add', date: holiday.date, name: holiday.name });
    } else if (row.source === 'google' && !row.isRemoved) {
      if (!row.isHoliday) changes.push({ action: 'restore', date: holiday.date, id: row.id, name: holiday.name });
      else if (row.holidayNote !== holiday.name) changes.push({ action: 'rename', date: holiday.date, id: row.id, name: holiday.name });
    }
  }

  for (const row of input.existing) {
    const date = row.date.slice(0, 10);
    if (date < input.today || listed.has(date)) continue;
    if (row.source === 'google' && row.isHoliday && !row.isRemoved) {
      changes.push({ action: 'drop', date, id: row.id, name: row.holidayNote });
    }
  }

  return changes.sort((left, right) => left.date.localeCompare(right.date));
}

/** Brings the holiday calendar in line with Google's public Ghana holiday feed. */
export async function syncGhanaHolidays(input: { actorEmail?: string; years: number[] }) {
  const events = await fetchGhanaHolidayFeed();
  const today = getAccraDateKey();
  const results: Array<{ changes: HolidaySyncChange[]; holidays: number; year: number }> = [];

  for (const year of input.years) {
    const holidays = publicHolidaysFrom(events, year);
    const existing = await db.select({
      date: workCalendar.date,
      holidayNote: workCalendar.holidayNote,
      id: workCalendar.id,
      isHoliday: workCalendar.isHoliday,
      isRemoved: workCalendar.isRemoved,
      source: workCalendar.source,
    })
      .from(workCalendar)
      .where(and(gte(workCalendar.date, `${year}-01-01`), lte(workCalendar.date, `${year}-12-31`)));
    const changes = planHolidaySync({ existing, holidays, today });
    const now = new Date();

    // Days the Ghana overrides move (e.g. Republic Day observed on another day).
    const suppressedDates = getSuppressedGhanaHolidayDatesForScope({ year }).filter((date) => date >= today);
    if (suppressedDates.length > 0) {
      await db.update(workCalendar)
        .set({ isHoliday: false, isRemoved: true, updatedAt: now })
        .where(and(inArray(workCalendar.date, suppressedDates), eq(workCalendar.source, 'google'), eq(workCalendar.isHoliday, true)));
    }

    for (const change of changes) {
      if (change.action === 'add') {
        await db.insert(workCalendar)
          .values({ date: change.date, holidayNote: change.name, isHoliday: true, isRemoved: false, source: 'google' })
          .onConflictDoNothing();
      } else if (change.action === 'drop') {
        await db.update(workCalendar).set({ isHoliday: false, updatedAt: now }).where(eq(workCalendar.id, change.id));
      } else {
        await db.update(workCalendar).set({ holidayNote: change.name, isHoliday: true, updatedAt: now }).where(eq(workCalendar.id, change.id));
      }
    }

    results.push({ changes, holidays: holidays.length, year });
  }

  const changed = results.flatMap((result) => result.changes);
  if (changed.length > 0) {
    publishRealtime('dashboard', 'invalidate', { reason: 'calendar' });
    publishRealtime('attendance', 'invalidate', { reason: 'calendar' });
  }
  await tryWriteAuditEvent({
    entityType: 'calendar',
    entityId: `sync-${today}`,
    action: 'SYNC',
    before: null,
    after: {
      changes: changed,
      holidaysListed: Object.fromEntries(results.map((result) => [result.year, result.holidays])),
      years: input.years,
    },
    actor: { email: input.actorEmail || 'system' },
    publish: false,
    reason: 'calendar',
  });

  return { results, today };
}
