// One profile follows a person through every type: intern → NSS → special staff → main staff.
// A type change applies from a chosen date; days before it keep the earlier type.

export const STAFF_TYPES = ['intern', 'nss', 'special', 'main'] as const;
export type StaffType = typeof STAFF_TYPES[number];
// While deactivated or archived a person is away: never charged.
export type StaffTypeOnDate = StaffType | 'away';

export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  intern: 'Intern',
  main: 'Main staff',
  nss: 'NSS',
  special: 'Special staff',
};

export const STAFF_TYPE_CHARGE_NOTES: Record<StaffType, string> = {
  intern: 'Not charged',
  main: 'Charged',
  nss: 'No hourly charge',
  special: 'Not charged',
};

export interface StaffTypeChange {
  effectiveFrom: string;
  staffType: string;
}

export interface StaffTypeFields {
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  staffType?: string | null;
}

export function isStaffType(value: unknown): value is StaffType {
  return typeof value === 'string' && (STAFF_TYPES as readonly string[]).includes(value);
}

export function staffTypeOf(member: StaffTypeFields): StaffType {
  if (isStaffType(member.staffType)) return member.staffType;
  if (member.isAttendanceOnly === true) return 'special';
  if (member.isNssPersonnel === true) return 'nss';
  return 'main';
}

// The two flags the charge rules read, kept on the staff row as the current type.
export function flagsForStaffType(type: StaffTypeOnDate) {
  return {
    isAttendanceOnly: type === 'intern' || type === 'special' || type === 'away',
    isNssPersonnel: type === 'nss',
  };
}

export function staffTypeRank(type: StaffType) {
  return STAFF_TYPES.indexOf(type);
}

// Types only move forward, and main staff is final.
export function canChangeStaffType(from: StaffType, to: StaffType) {
  return from === to || (from !== 'main' && staffTypeRank(to) > staffTypeRank(from));
}

export function allowedStaffTypes(from: StaffType) {
  return STAFF_TYPES.filter((type) => canChangeStaffType(from, type));
}

export function sortStaffTypeChanges<T extends StaffTypeChange>(changes: T[]) {
  return [...changes].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
}

// The latest type change, if it can be undone (a mistake: wrong person, type or date). Only the
// latest one, and only while the person is here; undoing it puts back the type before it. A
// change made on a return (restored as a later type) keeps the return and only reverts the type.
export function undoableStaffTypeChange(changes: StaffTypeChange[] | undefined) {
  const sorted = sortStaffTypeChanges(changes || []);
  const last = sorted.at(-1);
  if (!last || !isStaffType(last.staffType)) return null;
  const previousType = sorted.slice(0, -1).reverse().find((change) => isStaffType(change.staffType))?.staffType;
  if (!isStaffType(previousType) || previousType === last.staffType) return null;
  return {
    effectiveFrom: last.effectiveFrom,
    previousType,
    revertOnly: sorted.at(-2)?.staffType === 'away',
    staffType: last.staffType,
  };
}

// The type on a day: the latest change on or before it. With no changes the current type applies.
export function staffTypeOn(dateKey: string, changes: StaffTypeChange[] | undefined, current: StaffTypeFields): StaffTypeOnDate {
  let type: StaffTypeOnDate | null = null;
  for (const change of sortStaffTypeChanges(changes || [])) {
    if (change.effectiveFrom > dateKey) break;
    if (change.staffType === 'away' || isStaffType(change.staffType)) type = change.staffType as StaffTypeOnDate;
  }
  return type ?? staffTypeOf(current);
}

export function penaltyFlagsOn(dateKey: string, changes: StaffTypeChange[] | undefined, current: StaffTypeFields) {
  if (!changes || changes.length === 0) {
    return { isAttendanceOnly: current.isAttendanceOnly === true, isNssPersonnel: current.isNssPersonnel === true };
  }
  return flagsForStaffType(staffTypeOn(dateKey, changes, current));
}

// A real calendar day in YYYY-MM-DD form (not 2026-02-30).
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Why a type change can't be saved, or null when it can.
export function staffTypeChangeError(input: {
  effectiveFrom: string;
  from: StaffType;
  latestChangeDate?: string | null;
  to: StaffType;
  today: string;
}) {
  if (input.from === input.to) return null;
  if (input.from === 'main') return 'Main staff stay main staff.';
  if (!canChangeStaffType(input.from, input.to)) {
    return `${STAFF_TYPE_LABELS[input.from]} can only move on to ${allowedStaffTypes(input.from).filter((type) => type !== input.from).map((type) => STAFF_TYPE_LABELS[type]).join(', ')}.`;
  }
  if (!isValidDateKey(input.effectiveFrom)) return 'Choose the date the new type starts.';
  if (input.effectiveFrom > input.today) return 'The new type can’t start in the future.';
  if (input.latestChangeDate && input.effectiveFrom < input.latestChangeDate) {
    return `The new type can’t start before ${input.latestChangeDate}, when the last change started.`;
  }
  return null;
}

// Why a return (restore or activate) can't start on this date, or null when it can. Days they
// were away stay away, and days under an earlier type keep it.
export function staffReturnDateError(input: {
  awayStart?: string | null;
  effectiveFrom: string;
  latestChangeDate?: string | null;
  today: string;
}) {
  if (!isValidDateKey(input.effectiveFrom)) return 'Choose the date they are back from.';
  if (input.effectiveFrom > input.today) return 'The return date can’t be in the future.';
  if (input.awayStart && input.awayStart <= input.today && input.effectiveFrom < input.awayStart) {
    return `The return date can’t be before ${input.awayStart}, when they left.`;
  }
  if (input.latestChangeDate && input.effectiveFrom < input.latestChangeDate) {
    return `The return date can’t be before ${input.latestChangeDate}, when the last change started.`;
  }
  return null;
}

// Days before someone's first change keep the type they had, from any date in the past.
export const HISTORY_START = '2000-01-01';

function chargedAs(type: StaffTypeOnDate) {
  return !flagsForStaffType(type).isAttendanceOnly;
}

// The day someone's not-charged type began, from their changes; null when they were never charged
// (or when the history disagrees with their current type). Time away in between and moves between
// uncharged types don't restart it (intern → special keeps the intern start).
export function currentStaffTypeSince(changes: StaffTypeChange[] | undefined, current: StaffType) {
  const typed = sortStaffTypeChanges(changes || []).filter((change) => change.staffType !== 'away').reverse();
  if (typed.length === 0 || typed[0].staffType !== current || chargedAs(current)) return null;
  let since: string | null = null;
  for (const change of typed) {
    if (!isStaffType(change.staffType) || chargedAs(change.staffType)) break;
    since = change.effectiveFrom;
  }
  return since && since > HISTORY_START ? since : null;
}

export interface StaffChargeStatus {
  charged: boolean;
  label: string;
  since: string | null;
  staffType: StaffType;
}

// Whether this person is charged today. Charging reads the isAttendanceOnly flag, so the badge does
// too (the type only names it); rows without the flag fall back to the type's rule.
export function isChargedNow(member: StaffTypeFields) {
  return typeof member.isAttendanceOnly === 'boolean' ? !member.isAttendanceOnly : chargedAs(staffTypeOf(member));
}

// What a person's own pages say about charges.
export function chargeStatusFor(member: StaffTypeFields, changes?: StaffTypeChange[]): StaffChargeStatus {
  const staffType = staffTypeOf(member);
  return {
    charged: isChargedNow(member),
    label: STAFF_TYPE_LABELS[staffType],
    since: currentStaffTypeSince(changes, staffType),
    staffType,
  };
}

function formatDayMonthYear(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC', year: 'numeric' });
}

// The line at the top of their penalty history, or null for people who are charged.
// With no earlier charges there is nothing kept below, so that sentence is left out.
export function notChargedNote(status: StaffChargeStatus | null | undefined, hasHistory = true) {
  if (!status || status.charged) return null;
  const who = status.staffType === 'intern' ? 'an intern' : 'special staff';
  const note = status.since
    ? `Since ${formatDayMonthYear(status.since)} you're ${who} and are not charged.`
    : `As ${who} you are not charged.`;
  return hasHistory ? `${note} Earlier charges and receipts are kept below.` : note;
}
