export const STAFF_INACTIVE_REASONS = [
  { value: 'administrative_hold', label: 'Administrative hold' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'temporarily_not_monitored', label: 'Temporarily not monitored' },
  { value: 'other', label: 'Other' },
] as const;

export type StaffInactiveReason = typeof STAFF_INACTIVE_REASONS[number]['value'];

const VALID_REASONS = new Set<string>(STAFF_INACTIVE_REASONS.map((reason) => reason.value));

export function normalizeStaffInactiveReason(value: unknown): StaffInactiveReason | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return VALID_REASONS.has(normalized) ? normalized as StaffInactiveReason : null;
}

export function formatStaffInactiveReason(value: string | null | undefined) {
  const normalized = normalizeStaffInactiveReason(value);
  return STAFF_INACTIVE_REASONS.find((reason) => reason.value === normalized)?.label || 'Inactive';
}
