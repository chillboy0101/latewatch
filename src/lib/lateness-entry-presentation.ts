import {
  formatAbsencePermissionReason,
  formatLateArrivalPermissionReason,
  getPermissionWindowBounds,
} from '@/lib/attendance-permissions';

export type LatenessEntryPresentationRow = {
  arrivalTime: string | null;
  computedAmount: string | number | null;
  createdAt?: Date | string | null;
  date: string;
  didNotSignOut?: boolean | null;
  isExcusedAbsence?: boolean | null;
  id: string;
  isGeneralPardon?: boolean | null;
  noShowSignInWaived?: boolean | null;
  noSignOutWaived?: boolean | null;
  reason?: string | null;
  signOutTime?: string | null;
  staffId: string;
};

export type AttendanceEntryPresentationRow = {
  checkInTime: string | null;
  computedAmount: string | number | null;
  createdAt?: Date | string | null;
  date: string;
  id: string;
  noShowSignInWaived?: boolean | null;
  noShowSignInWaivedAt?: Date | string | null;
  noShowSignInWaivedReason?: string | null;
  noSignOutWaived?: boolean | null;
  noSignOutWaivedAt?: Date | string | null;
  noSignOutWaivedReason?: string | null;
  reason?: string | null;
  signOutTime?: string | null;
  source?: string | null;
  staffId: string;
  status?: string | null;
  updatedAt?: Date | string | null;
};

export type PermissionEntryPresentationRow = {
  arrivalWindow?: string | null;
  date: string;
  expectedEndTime?: string | null;
  expectedStartTime?: string | null;
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

function isExcusedAbsenceEntry(row: { permissionType?: string | null; reason?: string | null; status?: string | null }) {
  return row.permissionType === 'absence' || row.status === 'excused' || (row.reason || '').toLowerCase().startsWith('excused absence');
}

function formatPermissionFallbackReason(row: PermissionEntryPresentationRow) {
  if (isGeneralPardonEntryReason(row.reason)) return 'General pardon';
  if (row.permissionType === 'absence') {
    return `Excused absence: ${formatAbsencePermissionReason(row.reason)}`.trim();
  }

  const window = getPermissionWindowBounds({
    arrivalWindow: row.arrivalWindow || 'any_time_today',
    expectedEndTime: row.expectedEndTime || null,
    expectedStartTime: row.expectedStartTime || null,
    permissionType: 'late_arrival',
  });

  return `Approved late arrival (${window.label}): ${formatLateArrivalPermissionReason(row.reason)}`.trim();
}

function hasVisibleAttendanceState(row: AttendanceEntryPresentationRow) {
  return (
    Boolean(row.checkInTime) ||
    Boolean(row.signOutTime) ||
    amountNumber(row.computedAmount) > 0 ||
    Boolean(row.reason) ||
    row.noSignOutWaived === true ||
    row.noShowSignInWaived === true ||
    row.source === 'entries_manual_check_in' ||
    row.source === 'no_show_sign_in_waiver' ||
    row.status === 'late' ||
    row.status === 'excused'
  );
}

export function mergeAttendanceRowsIntoEntryRows(input: {
  attendanceRows: AttendanceEntryPresentationRow[];
  entryRows: LatenessEntryPresentationRow[];
  permissionRows?: PermissionEntryPresentationRow[];
}) {
  const attendanceByKey = new Map(
    input.attendanceRows.map((row) => [`${row.staffId}:${dateKey(row.date)}`, row]),
  );
  const entryRows = input.entryRows.map((entry) => {
    const attendance = attendanceByKey.get(`${entry.staffId}:${dateKey(entry.date)}`);

    return {
      ...entry,
      isGeneralPardon: entry.isGeneralPardon ?? isGeneralPardonEntryReason(entry.reason),
      noShowSignInWaived: entry.noShowSignInWaived ?? (attendance?.noShowSignInWaived === true),
      noSignOutWaived: entry.noSignOutWaived ?? (attendance?.noSignOutWaived === true),
      signOutTime: entry.signOutTime ?? attendance?.signOutTime ?? null,
    };
  });
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
      isExcusedAbsence: isExcusedAbsenceEntry(row),
      isGeneralPardon: isGeneralPardonEntryReason(row.reason),
      noShowSignInWaived: row.noShowSignInWaived === true,
      noSignOutWaived: row.noSignOutWaived === true,
      reason: row.reason || (row.noShowSignInWaived === true ? 'No-show waived' : row.noSignOutWaived === true ? 'No sign-out waived' : null),
      signOutTime: row.signOutTime || null,
      staffId: row.staffId,
    }));
  const occupiedKeys = new Set([
    ...existingEntryKeys,
    ...attendanceFallbackRows.map((row) => `${row.staffId}:${dateKey(row.date)}`),
  ]);
  const permissionFallbackRows = (input.permissionRows || [])
    .filter((row) => row.status === 'approved' && (row.permissionType === 'absence' || row.permissionType === 'late_arrival'))
    .filter((row) => !occupiedKeys.has(`${row.staffId}:${dateKey(row.date)}`))
    .map((row): LatenessEntryPresentationRow => ({
      arrivalTime: null,
      computedAmount: '0.00',
      createdAt: null,
      date: dateKey(row.date),
      didNotSignOut: false,
      id: `permission:${row.id}`,
      isExcusedAbsence: isExcusedAbsenceEntry(row),
      isGeneralPardon: isGeneralPardonEntryReason(row.reason),
      noShowSignInWaived: false,
      noSignOutWaived: false,
      reason: formatPermissionFallbackReason(row),
      signOutTime: null,
      staffId: row.staffId,
    }));

  return [...entryRows, ...attendanceFallbackRows, ...permissionFallbackRows];
}
