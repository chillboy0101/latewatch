import { differenceInCalendarDays, format, parseISO } from 'date-fns';

export const STAFF_LEAVE_TYPES = [
  { label: 'Annual', value: 'annual' },
  { label: 'Sick', value: 'sick' },
  { label: 'Maternity/Paternity', value: 'maternity_paternity' },
  { label: 'Study', value: 'study' },
  { label: 'Other', value: 'other' },
] as const;

export type StaffLeaveType = typeof STAFF_LEAVE_TYPES[number]['value'];

export type StaffLeavePeriodLike = {
  endDate: string | Date | null;
  leaveType?: string | null;
  returnedOn?: string | Date | null;
  source?: string | null;
  staffId: string;
  startDate: string | Date;
};

function dateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function previousDateKey(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function getEffectiveLeaveEndDate(period: {
  endDate?: string | Date | null;
  returnedOn?: string | Date | null;
} | null | undefined) {
  if (!period) return null;

  const plannedEndDate = dateKey(period.endDate);
  const returnedOn = dateKey(period.returnedOn);

  if (!returnedOn) return plannedEndDate || null;

  return [plannedEndDate, previousDateKey(returnedOn)].filter(Boolean).sort()[0] || plannedEndDate || null;
}

export function getExpectedReturnDate(period: {
  endDate?: string | Date | null;
  returnedOn?: string | Date | null;
} | null | undefined) {
  if (!period) return null;

  const plannedEndDate = dateKey(period.endDate);
  const actualReturnDate = dateKey(period.returnedOn);

  if (!plannedEndDate) return actualReturnDate || null;
  if (!actualReturnDate) return plannedEndDate;

  return actualReturnDate > plannedEndDate ? plannedEndDate : actualReturnDate;
}

export function getActiveLeavePeriod(periods: StaffLeavePeriodLike[], staffId: string, date: string) {
  const matching = periods.filter((period) => {
    if (!period || period.staffId !== staffId || period.source === 'staff_status') return false;

    const startDate = dateKey(period.startDate);
    const effectiveEndDate = getEffectiveLeaveEndDate(period);
    return date >= startDate && (!effectiveEndDate || date <= effectiveEndDate);
  });

  return matching.sort((left, right) => dateKey(right.startDate).localeCompare(dateKey(left.startDate)))[0] || null;
}

export function formatLeaveDuration(
  period: {
    endDate?: string | Date | null;
    leaveType?: string | null;
    returnedOn?: string | Date | null;
    startDate?: string | Date | null;
  } | null | undefined,
  referenceDate?: Date | string,
) {
  if (!period || !period.startDate) return '0 days';

  const startDate = parseISO(dateKey(period.startDate));
  const shutdownDate = parseISO(dateKey(getEffectiveLeaveEndDate(period) || referenceDate || period.endDate || period.startDate));
  const comparisonDate = referenceDate ? parseISO(dateKey(referenceDate)) : shutdownDate;
  const relevantEndDate = comparisonDate > shutdownDate ? shutdownDate : comparisonDate;
  const dayCount = Math.max(1, differenceInCalendarDays(relevantEndDate, startDate) + 1);

  return `${dayCount} day${dayCount === 1 ? '' : 's'}`;
}

/** Short leave note for badges: "until 20 Nov", "no end date" or "returned 20 Sep". */
export function formatLeaveSummary(
  period: {
    endDate?: string | Date | null;
    leaveType?: string | null;
    returnedOn?: string | Date | null;
    startDate?: string | Date | null;
  } | null | undefined,
) {
  if (!period || !period.startDate) return 'Not on leave';

  const returnedOn = dateKey(period.returnedOn);
  if (returnedOn) return `returned ${format(parseISO(returnedOn), 'd MMM')}`;

  const endDate = getEffectiveLeaveEndDate(period);
  return endDate ? `until ${format(parseISO(endDate), 'd MMM')}` : 'no end date';
}

export function isStaffLeaveDate(periods: StaffLeavePeriodLike[], staffId: string, date: string) {
  return Boolean(getActiveLeavePeriod(periods, staffId, date));
}

export function leaveRangesOverlap(input: {
  existingEndDate: string | Date | null;
  existingReturnedOn?: string | Date | null;
  existingStartDate: string | Date;
  startDate: string;
  endDate: string;
}) {
  const existingStartDate = dateKey(input.existingStartDate);
  const existingPlannedEndDate = dateKey(input.existingEndDate);
  const existingReturnedOn = dateKey(input.existingReturnedOn);
  const existingEndDate = existingReturnedOn
    ? [existingPlannedEndDate, previousDateKey(existingReturnedOn)].filter(Boolean).sort()[0]
    : existingPlannedEndDate;

  return existingStartDate <= input.endDate
    && (!existingEndDate || existingEndDate >= input.startDate);
}

// Database overlap refusals arrive wrapped by the driver (code on error.cause); turn them into a
// message the admin can act on instead of a generic failure. Only the overlap error codes count.
export function leaveOverlapError(error: unknown) {
  const parts = [error, (error as { cause?: unknown } | null)?.cause];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const code = String((part as { code?: unknown }).code || '');
    if (code === '23P01' || code === '23505') {
      return 'These dates overlap another leave period, or a time this person was deactivated.';
    }
  }
  return null;
}

function nextDayKey(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// "26 Oct – 30 Oct (5 days)" only for a continuous run; otherwise each day is listed.
export function formatPermissionDays(dates: string[]) {
  if (dates.length === 0) return '';
  const label = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const consecutive = dates.every((date, index) => index === 0 || date === nextDayKey(dates[index - 1]));
  if (dates.length > 3 && consecutive) return `${label(dates[0])} – ${label(dates[dates.length - 1])} (${dates.length} days)`;
  return dates.map(label).join(', ');
}
