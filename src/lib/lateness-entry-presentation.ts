export type LatenessEntryPresentationRow = {
  arrivalTime: string | null;
  computedAmount: string | number | null;
  createdAt?: Date | string | null;
  date: string;
  didNotSignOut?: boolean | null;
  id: string;
  reason?: string | null;
  staffId: string;
};

export type AttendanceEntryPresentationRow = {
  checkInTime: string | null;
  computedAmount: string | number | null;
  createdAt?: Date | string | null;
  date: string;
  id: string;
  reason?: string | null;
  staffId: string;
  status?: string | null;
  updatedAt?: Date | string | null;
};

function dateKey(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function amountNumber(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function hasVisibleAttendanceState(row: AttendanceEntryPresentationRow) {
  return (
    amountNumber(row.computedAmount) > 0 ||
    Boolean(row.reason) ||
    row.status === 'late' ||
    row.status === 'excused'
  );
}

export function mergeAttendanceRowsIntoEntryRows(input: {
  attendanceRows: AttendanceEntryPresentationRow[];
  entryRows: LatenessEntryPresentationRow[];
}) {
  const existingEntryKeys = new Set(
    input.entryRows.map((entry) => `${entry.staffId}:${dateKey(entry.date)}`),
  );
  const attendanceFallbackRows = input.attendanceRows
    .filter((row) => hasVisibleAttendanceState(row))
    .filter((row) => !existingEntryKeys.has(`${row.staffId}:${dateKey(row.date)}`))
    .map((row): LatenessEntryPresentationRow => ({
      arrivalTime: row.checkInTime,
      computedAmount: row.computedAmount,
      createdAt: row.createdAt || row.updatedAt || null,
      date: dateKey(row.date),
      didNotSignOut: false,
      id: `attendance:${row.id}`,
      reason: row.reason || null,
      staffId: row.staffId,
    }));

  return [...input.entryRows, ...attendanceFallbackRows];
}
