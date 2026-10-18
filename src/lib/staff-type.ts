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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return 'Choose the date the new type starts.';
  if (input.effectiveFrom > input.today) return 'The new type can’t start in the future.';
  if (input.latestChangeDate && input.effectiveFrom < input.latestChangeDate) {
    return `The new type can’t start before ${input.latestChangeDate}, when the last change started.`;
  }
  return null;
}
