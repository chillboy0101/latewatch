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

export function isStaffLeaveDate(periods: StaffLeavePeriodLike[], staffId: string, date: string) {
  return periods.some((period) => {
    if (!period || period.staffId !== staffId || period.source === 'staff_status') return false;

    const startDate = dateKey(period.startDate);
    const plannedEndDate = dateKey(period.endDate);
    const returnedOn = dateKey(period.returnedOn);
    const effectiveEndDate = returnedOn
      ? [plannedEndDate, previousDateKey(returnedOn)].filter(Boolean).sort()[0]
      : plannedEndDate;

    return date >= startDate && (!effectiveEndDate || date <= effectiveEndDate);
  });
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