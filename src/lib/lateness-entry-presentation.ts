export type LatenessEntryPresentationRow = {
  arrivalTime: string | null;
  computedAmount: string | number | null;
  createdAt?: Date | string | null;
  date: string;
  didNotSignOut?: boolean | null;
  id: string;
  isGeneralPardon?: boolean | null;
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
  source?: string | null;
  staffId: string;
  status?: string | null;
  updatedAt?: Date | string | null;
};

export type PermissionEntryPresentationRow = {
  date: string;
  id: string;
  permissionType?: string | null;
  reason?: string | null;
  staffId: string;
  status?: string | null;
};

function dateKey(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function amountNumber(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function isGeneralPardonEntryReason(value: string | null | undefined) {
  return typeof value === 'string' && value.toLowerCase().includes('general pardon');
}

function hasVisibleAttendanceState(row: AttendanceEntryPresentationRow) {
  return (
    amountNumber(row.computedAmount) > 0 ||
    Boolean(row.reason) ||
    row.source === 'entries_manual_check_in' ||
    row.status === 'late' ||
    row.status === 'excused'
  );
}

export function mergeAttendanceRowsIntoEntryRows(input: {
  attendanceRows: AttendanceEntryPresentationRow[];
  entryRows: LatenessEntryPresentationRow[];
  permissionRows?: PermissionEntryPresentationRow[];
}) {
  const entryRows = input.entryRows.map((entry) => ({
    ...entry,
    isGeneralPardon: entry.isGeneralPardon ?? isGeneralPardonEntryReason(entry.reason),
  }));
  const existingEntryKeys = new Set(
    entryRows.map((entry) => `${entry.staffId}:${dateKey(entry.date)}`),
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
      isGeneralPardon: isGeneralPardonEntryReason(row.reason),
      reason: row.reason || null,
      staffId: row.staffId,
    }));
  const occupiedKeys = new Set([
    ...existingEntryKeys,
    ...attendanceFallbackRows.map((row) => `${row.staffId}:${dateKey(row.date)}`),
  ]);
  const permissionFallbackRows = (input.permissionRows || [])
    .filter((row) => row.status === 'approved' && isGeneralPardonEntryReason(row.reason))
    .filter((row) => !occupiedKeys.has(`${row.staffId}:${dateKey(row.date)}`))
    .map((row): LatenessEntryPresentationRow => ({
      arrivalTime: null,
      computedAmount: '0.00',
      createdAt: null,
      date: dateKey(row.date),
      didNotSignOut: false,
      id: `permission:${row.id}`,
      isGeneralPardon: true,
      reason: 'General pardon',
      staffId: row.staffId,
    }));

  return [...entryRows, ...attendanceFallbackRows, ...permissionFallbackRows];
}
