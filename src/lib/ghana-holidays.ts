export type GhanaHolidayLike = {
  date: string;
  name: string;
  source: 'google';
};

const HOLIDAY_OVERRIDES = [
  {
    name: 'Republic Day',
    observedDate: '2026-07-03',
    suppressedDate: '2026-07-01',
  },
] as const;

type HolidayScope = {
  month?: number;
  year?: number;
};

function dateParts(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number);
  return { month: month - 1, year };
}

function scopeIncludesDate(scope: HolidayScope | undefined, dateKey: string) {
  if (!scope?.year && scope?.month === undefined) return true;

  const parts = dateParts(dateKey);
  if (scope.year !== undefined && scope.year !== parts.year) return false;
  if (scope.month !== undefined && scope.month !== parts.month) return false;

  return true;
}

export function isSuppressedGhanaHolidayDate(dateKey: string) {
  return HOLIDAY_OVERRIDES.some((holiday) => holiday.suppressedDate === dateKey);
}

export function getObservedGhanaHolidayForDate(dateKey: string) {
  const holiday = HOLIDAY_OVERRIDES.find((entry) => entry.observedDate === dateKey);
  if (!holiday) return null;

  return {
    date: holiday.observedDate,
    name: holiday.name,
    source: 'google' as const,
  };
}

export function getSuppressedGhanaHolidayDatesForScope(scope?: HolidayScope) {
  return HOLIDAY_OVERRIDES
    .map((holiday) => holiday.suppressedDate)
    .filter((date) => scopeIncludesDate(scope, date));
}

export function applyGhanaHolidayOverrides<T extends GhanaHolidayLike>(
  holidays: T[],
  scope?: HolidayScope,
): GhanaHolidayLike[] {
  const corrected: GhanaHolidayLike[] = holidays.filter((holiday) => !isSuppressedGhanaHolidayDate(holiday.date));

  for (const holiday of HOLIDAY_OVERRIDES) {
    if (!scopeIncludesDate(scope, holiday.observedDate)) continue;
    if (corrected.some((entry) => entry.date === holiday.observedDate)) continue;

    corrected.push({
      date: holiday.observedDate,
      name: holiday.name,
      source: 'google',
    });
  }

  return corrected.sort((a, b) => a.date.localeCompare(b.date));
}
