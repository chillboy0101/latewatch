export type OfficeLocationPolicyRow = {
  archivedAt?: Date | string | null;
  id: string;
  isActive?: boolean | null;
  locationKind?: string | null;
  scheduleEndDate?: string | null;
  scheduleStartDate?: string | null;
  updatedAt?: Date | string | null;
};

export function isValidDateKey(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function updatedAtTime(row: OfficeLocationPolicyRow) {
  if (!row.updatedAt) return 0;
  const date = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function isUsableLocation(row: OfficeLocationPolicyRow) {
  return row.isActive !== false && !row.archivedAt;
}

function isScheduledLocation(row: OfficeLocationPolicyRow) {
  return row.locationKind === 'scheduled' &&
    isValidDateKey(row.scheduleStartDate) &&
    isValidDateKey(row.scheduleEndDate);
}

function coversDate(row: OfficeLocationPolicyRow, dateKey: string) {
  return isScheduledLocation(row) &&
    row.scheduleStartDate! <= dateKey &&
    row.scheduleEndDate! >= dateKey;
}

export function resolveOfficeLocationForDate<T extends OfficeLocationPolicyRow>(
  locations: T[],
  dateKey: string,
): T | null {
  const usable = locations.filter(isUsableLocation);
  const scheduled = usable
    .filter((row) => coversDate(row, dateKey))
    .sort((a, b) => updatedAtTime(b) - updatedAtTime(a));

  if (scheduled[0]) return scheduled[0];

  return usable
    .filter((row) => row.locationKind === 'default' || !row.locationKind)
    .sort((a, b) => updatedAtTime(b) - updatedAtTime(a))[0] || null;
}

export function overlapsOfficeLocationSchedule(
  locations: OfficeLocationPolicyRow[],
  candidate: {
    endDate: string;
    excludeId?: string | null;
    startDate: string;
  },
) {
  return locations
    .filter(isUsableLocation)
    .filter((row) => row.id !== candidate.excludeId)
    .filter(isScheduledLocation)
    .some((row) => candidate.startDate <= row.scheduleEndDate! && candidate.endDate >= row.scheduleStartDate!);
}

