'use client';

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, FileText, Loader2, Printer, RotateCcw, Search, ShieldCheck, Smartphone, Trash2, UserRound, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import {
  ABSENCE_PERMISSION_REASONS,
  ATTENDANCE_PERMISSION_WINDOWS,
  LATE_ARRIVAL_PERMISSION_REASONS,
  formatAbsencePermissionReason,
  formatLateArrivalPermissionReason,
  getPermissionWindowBounds,
} from '@/lib/attendance-permissions';
import type { AttendanceStatus } from '@/lib/attendance-status';
import { formatDisplayDate, formatDisplayDateTime, isIsoDateKey } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';
import { isOnTimeCheckIn } from '@/lib/work-hours';

type AttendanceFilter = 'all' | 'on_time' | AttendanceStatus;
type GeneralPardonType = 'absence' | 'late_arrival';

interface AttendancePermission {
  approvedByEmail: string;
  arrivalWindow: string | null;
  date: string;
  expectedEndTime: string | null;
  expectedStartTime: string | null;
  id: string;
  permissionType: string;
  reason: string;
  staffEmail?: string | null;
  staffId: string;
  staffName?: string | null;
  status: string;
}

interface AttendanceRow {
  staff: {
    id: string;
    fullName: string;
    email: string | null;
    department: string | null;
    unit: string | null;
    isAttendanceOnly?: boolean | null;
    isNssPersonnel?: boolean | null;
  };
  attendance: {
    id: string;
    checkInAt: string;
    checkInTime: string;
    computedAmount: string;
    reason: string | null;
    signOutAt: string | null;
    signOutTime: string | null;
    status: AttendanceStatus;
  } | null;
  device: {
    deviceLabel: string | null;
    id: string | null;
    lastDistanceMeters: string | null;
    lastSeenAt: string | null;
    lastVerificationMethod: string | null;
    lastVerifiedAt: string | null;
    registered: boolean;
    registeredAt: string | null;
  };
  permission: AttendancePermission | null;
  status: AttendanceStatus;
  statuses?: AttendanceStatus[];
}

interface AttendanceAttempt {
  id: string;
  createdAt: string;
  result: string;
  successful: boolean;
  userEmail: string;
}

interface DeviceTransferRequest {
  accuracyMeters: string | null;
  deviceLabel: string | null;
  distanceMeters: string | null;
  id: string;
  locationAt: string | null;
  networkIp: string | null;
  requestedAt: string | null;
  staffEmail: string | null;
  staffId: string;
  staffName: string | null;
  status: string;
  userEmail: string;
  verificationResult: string | null;
}

interface AttendanceResponse {
  attempts: AttendanceAttempt[];
  date: string;
  network: {
    allowedIp: string | null;
    configured: boolean;
    currentIp: string;
    isOfficeNetwork: boolean;
    name: string | null;
    updatedAt: string | null;
    updatedByEmail: string | null;
  };
  rows: AttendanceRow[];
  permissions: AttendancePermission[];
  transferRequests: DeviceTransferRequest[];
  totals: {
    excused: number;
    expectedLate: number;
    late: number;
    noSignOut: number;
    notCheckedIn: number;
    onTime: number;
    permissionOverdue: number;
    present: number;
    totalStaff: number;
  };
}

interface AttendanceQrResponse {
  checkInUrl: string;
  qrSvg: string;
  type: string;
}

function todayKey() {
  return getAccraDateKey();
}

function statusLabel(status: AttendanceStatus) {
  if (status === 'present') return 'On Time';
  if (status === 'late') return 'Late';
  if (status === 'excused') return 'Excused';
  if (status === 'expected_late') return 'Expected later';
  if (status === 'permission_overdue') return 'Permission overdue';
  if (status === 'no_sign_out') return 'No sign-out';
  return 'Not checked in';
}

function statusClass(status: AttendanceStatus) {
  if (status === 'present') return 'border-success/25 bg-success/10 text-success';
  if (status === 'late') return 'border-warning/25 bg-warning/10 text-warning';
  if (status === 'excused') return 'border-primary/25 bg-primary/10 text-primary';
  if (status === 'expected_late') return 'border-primary/25 bg-primary/10 text-primary';
  if (status === 'permission_overdue') return 'border-danger/25 bg-danger/10 text-danger';
  if (status === 'no_sign_out') return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-border bg-muted/20 text-muted-foreground';
}

function StatusIcon({ status }: { status: AttendanceStatus }) {
  if (status === 'present') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'late') return <Clock className="h-3.5 w-3.5" />;
  if (status === 'excused') return <ShieldCheck className="h-3.5 w-3.5" />;
  if (status === 'expected_late') return <Clock className="h-3.5 w-3.5" />;
  if (status === 'permission_overdue') return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === 'no_sign_out') return <AlertTriangle className="h-3.5 w-3.5" />;
  return <XCircle className="h-3.5 w-3.5" />;
}

function rowStatuses(row: AttendanceRow) {
  return row.statuses?.length ? row.statuses : [row.status];
}

const STATUS_RANK: Record<AttendanceStatus, number> = {
  permission_overdue: 0,
  late: 1,
  no_sign_out: 2,
  not_checked_in: 3,
  expected_late: 4,
  excused: 5,
  present: 6,
};

function statusRankForRow(row: AttendanceRow) {
  return Math.min(...rowStatuses(row).map((status) => STATUS_RANK[status] ?? 99));
}

function permissionSummary(permission: AttendancePermission) {
  if (permission.permissionType === 'absence') {
    return `Excused absence / ${formatAbsencePermissionReason(permission.reason)}`;
  }

  return `Late arrival / ${getPermissionWindowBounds(permission).label} / ${formatLateArrivalPermissionReason(permission.reason)}`;
}

function isOnTimeAttendanceRow(row: AttendanceRow) {
  return isOnTimeCheckIn(row.attendance?.checkInTime);
}

export default function AttendancePage() {
  const [dateInput, setDateInput] = useState(todayKey());
  const [activeFilter, setActiveFilter] = useState<AttendanceFilter>('all');
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState<AttendanceQrResponse | null>(null);
  const [permissionStaffId, setPermissionStaffId] = useState('');
  const [permissionType, setPermissionType] = useState('late_arrival');
  const [permissionWindow, setPermissionWindow] = useState('any_time_today');
  const [permissionExpectedTime, setPermissionExpectedTime] = useState('10:30');
  const [permissionAbsenceStartDate, setPermissionAbsenceStartDate] = useState(todayKey());
  const [permissionAbsenceEndDate, setPermissionAbsenceEndDate] = useState(todayKey());
  const [permissionReason, setPermissionReason] = useState('');
  const [savingPermission, setSavingPermission] = useState(false);
  const [deletingPermissionId, setDeletingPermissionId] = useState<string | null>(null);
  const [generalPardonOpen, setGeneralPardonOpen] = useState(false);
  const [generalPardonType, setGeneralPardonType] = useState<GeneralPardonType>('absence');
  const [savingGeneralPardon, setSavingGeneralPardon] = useState(false);
  const [resettingDeviceStaffId, setResettingDeviceStaffId] = useState<string | null>(null);
  const [reviewingTransferId, setReviewingTransferId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const appliedDate = isIsoDateKey(dateInput) ? dateInput : '';
  const attendanceDate = appliedDate || todayKey();

  useEffect(() => {
    setPermissionAbsenceStartDate(attendanceDate);
    setPermissionAbsenceEndDate(attendanceDate);
  }, [attendanceDate]);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/attendance?date=${attendanceDate}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Attendance request failed (${response.status})`);
      setData(await response.json());
    } catch (err) {
      console.error('Failed to load attendance:', err);
      setError(err instanceof Error ? err.message : 'Could not load attendance');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [attendanceDate]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const response = await fetch('/api/attendance/qr', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load attendance QR');
        const qr = await response.json();
        if (mounted) setQrData(qr);
      } catch (error) {
        console.error('Failed to load attendance QR:', error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['attendance', 'dashboard'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: fetchAttendance,
          }),
        ),
      );

      if (mounted) {
        cleanups = unsubscribers;
      } else {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      }
    })();

    return () => {
      mounted = false;
      cleanups.forEach((unsubscribe) => unsubscribe());
    };
  }, [fetchAttendance]);

  async function savePermission() {
    if (!permissionStaffId || !permissionReason.trim()) {
      setNotice(null);
      setError(permissionType === 'absence'
        ? 'Select a staff member and choose the excused absence reason.'
        : 'Select a staff member and choose the late arrival reason.');
      return;
    }
    if (permissionType === 'absence') {
      if (!isIsoDateKey(permissionAbsenceStartDate) || !isIsoDateKey(permissionAbsenceEndDate)) {
        setError('Select a valid absence start and end date.');
        return;
      }
      if (permissionAbsenceEndDate < permissionAbsenceStartDate) {
        setError('Absence end date must be on or after the start date.');
        return;
      }
    }

    setSavingPermission(true);
    setError(null);
    setNotice(null);

    try {
      const payload = permissionType === 'absence'
        ? {
            absenceEndDate: permissionAbsenceEndDate,
            date: permissionAbsenceStartDate,
            permissionType,
            reason: permissionReason,
            staffId: permissionStaffId,
          }
        : {
            arrivalWindow: permissionWindow,
            date: attendanceDate,
            expectedEndTime: permissionWindow === 'specific_time' ? permissionExpectedTime : null,
            permissionType,
            reason: permissionReason,
            staffId: permissionStaffId,
          };
      const response = await fetch('/api/attendance/permissions', {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save permission');

      setPermissionReason('');
      setPermissionStaffId('');
      setPermissionType('late_arrival');
      setPermissionWindow('any_time_today');
      setPermissionExpectedTime('10:30');
      setPermissionAbsenceStartDate(attendanceDate);
      setPermissionAbsenceEndDate(attendanceDate);
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to save permission:', err);
      setError(err instanceof Error ? err.message : 'Could not save permission');
    } finally {
      setSavingPermission(false);
    }
  }

  async function deletePermission(permissionId: string) {
    setDeletingPermissionId(permissionId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/attendance/permissions/${permissionId}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not remove permission');
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to remove permission:', err);
      setError(err instanceof Error ? err.message : 'Could not remove permission');
    } finally {
      setDeletingPermissionId(null);
    }
  }

  async function applyGeneralPardon() {
    if (!isIsoDateKey(attendanceDate)) {
      setNotice(null);
      setError('Select a valid attendance date before applying a general pardon.');
      return;
    }

    setSavingGeneralPardon(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/attendance/permissions/general-pardon', {
        body: JSON.stringify({ date: attendanceDate, pardonType: generalPardonType }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not apply general pardon');

      setGeneralPardonOpen(false);
      setNotice(`General pardon applied to ${body.affectedCount ?? data?.rows.length ?? 0} staff for ${formatDisplayDate(attendanceDate)}.`);
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to apply general pardon:', err);
      setError(err instanceof Error ? err.message : 'Could not apply general pardon');
    } finally {
      setSavingGeneralPardon(false);
    }
  }

  async function resetDevice(staffId: string) {
    setResettingDeviceStaffId(staffId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/attendance/devices/${staffId}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not reset device');
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to reset attendance device:', err);
      setError(err instanceof Error ? err.message : 'Could not reset device');
    } finally {
      setResettingDeviceStaffId(null);
    }
  }

  async function reviewDeviceTransfer(transferId: string, action: 'approve' | 'reject') {
    setReviewingTransferId(transferId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/attendance/device-transfers/${transferId}`, {
        body: JSON.stringify({ action }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not review device transfer');
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to review device transfer:', err);
      setError(err instanceof Error ? err.message : 'Could not review device transfer');
    } finally {
      setReviewingTransferId(null);
    }
  }

  function printOfficeQr() {
    if (!qrData?.qrSvg) return;

    const printWindow = window.open('', '_blank', 'width=420,height=560');
    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>LateWatch Attendance QR</title>
          <style>
            body {
              align-items: center;
              color: #0f172a;
              display: flex;
              font-family: Arial, sans-serif;
              justify-content: center;
              margin: 0;
              min-height: 100vh;
            }
          .sheet {
              border: 1px solid #dbe3ef;
              border-radius: 16px;
              padding: 32px;
              text-align: center;
              width: 320px;
            }
            .qr {
              background: #fff;
              margin: 20px auto;
              width: 220px;
            }
            .qr svg {
              height: auto;
              width: 100%;
            }
            h1 {
              font-size: 24px;
              margin: 0;
            }
            p {
              color: #475569;
              font-size: 14px;
              line-height: 1.5;
              margin: 8px 0 0;
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <h1>LateWatch Attendance</h1>
            <p>Scan to install LateWatch or open attendance.</p>
            <div class="qr">${qrData.qrSvg}</div>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  const staffNameById = useMemo(() => new Map(
    (data?.rows || []).map((row) => [row.staff.id, row.staff.fullName]),
  ), [data?.rows]);

  const sortedRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const rows = (() => {
      if (activeFilter === 'all') return data?.rows || [];
      if (activeFilter === 'present') return (data?.rows || []).filter((row) => Boolean(row.attendance?.checkInTime));
      if (activeFilter === 'on_time') return (data?.rows || []).filter((row) => isOnTimeAttendanceRow(row));
      return (data?.rows || []).filter((row) => rowStatuses(row).includes(activeFilter));
    })();
    const filteredRows = query
      ? rows.filter((row) => [
          row.staff.fullName,
          row.staff.email || '',
          row.staff.department || '',
          row.staff.unit || '',
          row.staff.isAttendanceOnly ? 'attendance monitoring only special staff' : row.staff.isNssPersonnel ? 'nss personnel' : 'main staff',
        ].join(' ').toLowerCase().includes(query))
      : rows;

    return [...filteredRows].sort((a, b) => statusRankForRow(a) - statusRankForRow(b) || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [activeFilter, data?.rows, searchQuery]);

  const attendanceTableSections = useMemo(() => {
    const mainAttendanceRows = sortedRows.filter((row) => row.staff.isAttendanceOnly !== true && row.staff.isNssPersonnel !== true);
    const nssAttendanceRows = sortedRows.filter((row) => row.staff.isAttendanceOnly !== true && row.staff.isNssPersonnel === true);
    const monitoringOnlyAttendanceRows = sortedRows.filter((row) => row.staff.isAttendanceOnly === true);

    return [
      { key: 'main', rows: mainAttendanceRows, title: 'Main Staff' },
      { key: 'nss', rows: nssAttendanceRows, title: 'NSS Personnel' },
      { key: 'monitoringOnly', rows: monitoringOnlyAttendanceRows, title: 'Attendance Monitoring Only' },
    ].filter((section) => section.rows.length > 0);
  }, [sortedRows]);

  return (
    <DashboardLayout title="Attendance">
      <div className="space-y-5">
        <div className="grid auto-cols-[minmax(7.75rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-9 xl:overflow-visible xl:pb-0">
          <SummaryCard
            active={activeFilter === 'all'}
            label="Total Staff"
            onClick={() => setActiveFilter('all')}
            value={data?.totals.totalStaff ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'present'}
            label="Present"
            onClick={() => setActiveFilter('present')}
            tone="success"
            value={data?.totals.present ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'on_time'}
            label="On Time"
            onClick={() => setActiveFilter('on_time')}
            tone="success"
            value={data?.totals.onTime ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'late'}
            label="Late"
            onClick={() => setActiveFilter('late')}
            tone="warning"
            value={data?.totals.late ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'expected_late'}
            label="Expected Later"
            onClick={() => setActiveFilter('expected_late')}
            value={data?.totals.expectedLate ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'excused'}
            label="Excused"
            onClick={() => setActiveFilter('excused')}
            value={data?.totals.excused ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'permission_overdue'}
            label="Overdue"
            onClick={() => setActiveFilter('permission_overdue')}
            tone="danger"
            value={data?.totals.permissionOverdue ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'no_sign_out'}
            label="No Sign-Out"
            onClick={() => setActiveFilter('no_sign_out')}
            tone="warning"
            value={data?.totals.noSignOut ?? 0}
          />
          <SummaryCard
            active={activeFilter === 'not_checked_in'}
            label="Not Checked In"
            onClick={() => setActiveFilter('not_checked_in')}
            tone="muted"
            value={data?.totals.notCheckedIn ?? 0}
          />
        </div>

        <Card className="overflow-hidden">
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-12 xl:items-end">
            <SelectField
              className="xl:col-span-3"
              icon={<UserRound className="h-3.5 w-3.5" />}
              label="Staff"
              value={permissionStaffId}
              onChange={setPermissionStaffId}
            >
                <option value="">Select staff</option>
                {(data?.rows || []).map((row) => (
                  <option key={row.staff.id} value={row.staff.id}>{row.staff.fullName}</option>
                ))}
            </SelectField>
            <SelectField
              className={permissionType === 'absence' ? 'xl:col-span-3' : 'xl:col-span-2'}
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              label="Permission"
              value={permissionType}
              onChange={(value) => {
                setPermissionType(value);
                setPermissionReason('');
                if (value === 'absence') {
                  setPermissionWindow('any_time_today');
                  setPermissionAbsenceStartDate(attendanceDate);
                  setPermissionAbsenceEndDate(attendanceDate);
                }
              }}
            >
                <option value="late_arrival">Late arrival</option>
                <option value="absence">Excused absence</option>
            </SelectField>
            {permissionType === 'late_arrival' ? (
              <>
                <div className="min-w-0 space-y-2 xl:col-span-2">
                  <SelectField
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Arrival"
                    value={permissionWindow}
                    onChange={setPermissionWindow}
                  >
                    {ATTENDANCE_PERMISSION_WINDOWS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SelectField>
                  {permissionWindow === 'specific_time' && (
                    <Input
                      className="h-11 font-medium"
                      type="time"
                      value={permissionExpectedTime}
                      onChange={(event) => setPermissionExpectedTime(event.target.value)}
                    />
                  )}
                </div>
                <div className="min-w-0 xl:col-span-3">
                  <SelectField
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label="Reason"
                    value={permissionReason}
                    onChange={setPermissionReason}
                  >
                    <option value="">Select late arrival reason</option>
                    {LATE_ARRIVAL_PERMISSION_REASONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SelectField>
                </div>
              </>
            ) : (
              <>
                <DateField
                  className="xl:col-span-3"
                  label="Absence Start"
                  value={permissionAbsenceStartDate}
                  onChange={setPermissionAbsenceStartDate}
                />
                <DateField
                  className="xl:col-span-3"
                  label="Absence End"
                  value={permissionAbsenceEndDate}
                  onChange={setPermissionAbsenceEndDate}
                />
                <SelectField
                  className="xl:col-span-10"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Reason"
                  value={permissionReason}
                  onChange={setPermissionReason}
                >
                  <option value="">Select absence reason</option>
                  {ABSENCE_PERMISSION_REASONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </SelectField>
              </>
            )}
            <Button className="h-11 w-full gap-2 px-4 xl:col-span-2" onClick={savePermission} disabled={savingPermission}>
              {savingPermission ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Approve
            </Button>
          </div>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold">General pardon</p>
              <p className="mt-1 text-xs text-muted-foreground">Excuse everyone or clear late fees for {formatDisplayDate(attendanceDate)}.</p>
            </div>
            <Button
              className="h-10 gap-2 lg:w-auto"
              variant="outline"
              onClick={() => setGeneralPardonOpen(true)}
              disabled={savingGeneralPardon || !data?.rows.length}
            >
              <ShieldCheck className="h-4 w-4" />
              Grant General Pardon
            </Button>
          </div>
          {(data?.permissions || []).length > 0 && (
            <div className="divide-y divide-border border-t border-border">
              {data?.permissions.map((permission) => (
                <div key={permission.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {permission.staffName || staffNameById.get(permission.staffId) || 'Staff member'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {permissionSummary(permission)}
                    </p>
                  </div>
                  <Button
                    className="h-8 gap-2 border-danger/40 text-danger hover:bg-danger/10"
                    size="sm"
                    variant="outline"
                    onClick={() => deletePermission(permission.id)}
                    disabled={deletingPermissionId === permission.id}
                  >
                    {deletingPermissionId === permission.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Dialog
          open={generalPardonOpen}
          onOpenChange={(open) => {
            if (!savingGeneralPardon) setGeneralPardonOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>General pardon</DialogTitle>
              <DialogDescription>{formatDisplayDate(attendanceDate)} - {data?.rows.length ?? 0} staff</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setGeneralPardonType('absence')}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5',
                  generalPardonType === 'absence' ? 'border-primary bg-primary/10' : 'border-border bg-background',
                )}
              >
                <span className="block text-sm font-semibold">Full-day excuse</span>
                <span className="mt-1 block text-xs text-muted-foreground">Everyone excused. Penalties cleared.</span>
              </button>
              <button
                type="button"
                onClick={() => setGeneralPardonType('late_arrival')}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5',
                  generalPardonType === 'late_arrival' ? 'border-primary bg-primary/10' : 'border-border bg-background',
                )}
              >
                <span className="block text-sm font-semibold">Late-only pardon</span>
                <span className="mt-1 block text-xs text-muted-foreground">Late fees cleared. Absences stay.</span>
              </button>
            </div>

            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Bulk action. You can remove records later.
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setGeneralPardonOpen(false)}
                disabled={savingGeneralPardon}
              >
                Cancel
              </Button>
              <Button className="gap-2" onClick={applyGeneralPardon} disabled={savingGeneralPardon}>
                {savingGeneralPardon ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Apply pardon
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(18rem,1fr)_13rem_7.5rem] xl:items-end">
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search staff or email"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <DateField
              value={dateInput}
              onChange={setDateInput}
              label="Attendance Date"
            />
            <Button className="h-11 w-full gap-2 px-4 xl:self-end" onClick={printOfficeQr} disabled={!qrData?.qrSvg}>
              <Printer className="h-4 w-4" />
              Print QR
            </Button>
          </div>
        </Card>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            {notice}
          </div>
        )}

        {(data?.transferRequests || []).length > 0 && (
          <Card>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold">Device Transfer Requests</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Approve only when you have confirmed the staff member is physically present.
              </p>
            </div>
            <div className="divide-y divide-border">
              {data?.transferRequests.map((request) => (
                <div key={request.id} className="grid gap-3 px-5 py-4 xl:grid-cols-[minmax(14rem,1fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)_12rem] xl:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{request.staffName || request.userEmail}</p>
                    <p className="truncate text-xs text-muted-foreground">{request.staffEmail || request.userEmail}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.deviceLabel || 'New attendance device'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {request.requestedAt ? formatDisplayDateTime(request.requestedAt) : 'Pending review'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {request.distanceMeters ? `${Math.round(Number(request.distanceMeters))}m from office` : 'Location captured'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {request.accuracyMeters ? `${Math.round(Number(request.accuracyMeters))}m accuracy` : request.verificationResult || 'Verified location'}
                    </p>
                  </div>
                  <div className="flex gap-2 xl:justify-end">
                    <Button
                      className="h-9 gap-2"
                      onClick={() => reviewDeviceTransfer(request.id, 'approve')}
                      disabled={reviewingTransferId === request.id}
                    >
                      {reviewingTransferId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Approve
                    </Button>
                    <Button
                      className="h-9 gap-2 border-danger/40 text-danger hover:bg-danger/10"
                      variant="outline"
                      onClick={() => reviewDeviceTransfer(request.id, 'reject')}
                      disabled={reviewingTransferId === request.id}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          {loading ? (
            <LoadingBuffer variant="section" label="Loading attendance" description="Checking today's sign-ins." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-card">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Device</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Check-In</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Sign-Out</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Penalty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attendanceTableSections.map((section) => (
                    <Fragment key={section.key}>
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.title}
                        </td>
                      </tr>
                      {section.rows.map((row) => (
                        <tr key={row.staff.id} className="transition-colors hover:bg-card/50">
                          <td className="px-4 py-3 text-sm font-medium">{row.staff.fullName}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{row.staff.email || 'Not linked'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                                row.device.registered
                                  ? 'border-success/25 bg-success/10 text-success'
                                  : 'border-border bg-muted/20 text-muted-foreground',
                              )}>
                                <Smartphone className="h-3.5 w-3.5" />
                                {row.device.registered ? 'Linked' : 'Not linked'}
                              </span>
                              {row.device.registered && (
                                <Button
                                  className="h-8 gap-1.5 px-2"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => resetDevice(row.staff.id)}
                                  disabled={resettingDeviceStaffId === row.staff.id}
                                >
                                  {resettingDeviceStaffId === row.staff.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  Reset
                                </Button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">
                            {row.attendance?.checkInTime ? row.attendance.checkInTime.slice(0, 5) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">
                            {row.attendance?.signOutTime ? row.attendance.signOutTime.slice(0, 5) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {rowStatuses(row).map((status) => (
                                <span key={status} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusClass(status))}>
                                  <StatusIcon status={status} />
                                  {statusLabel(status)}
                                </span>
                              ))}
                            </div>
                            {row.permission && (
                              <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground" title={permissionSummary(row.permission)}>
                                {permissionSummary(row.permission)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">
                            {Number(row.attendance?.computedAmount || 0) > 0
                              ? `GHC ${Number(row.attendance?.computedAmount || 0).toFixed(2)}`
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {attendanceTableSections.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No staff in this filter
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Recent Attendance Attempts</h2>
          </div>
          <div className="divide-y divide-border">
            {(data?.attempts || []).length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No attempts recorded for this date.</p>
            ) : (
              data?.attempts.map((attempt) => (
                <div key={attempt.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md',
                      attempt.successful ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                    )}>
                      {attempt.successful ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{attempt.userEmail}</p>
                      <p className="text-xs text-muted-foreground">{attempt.result.replace(/_/g, ' ').toLowerCase()}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(attempt.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SummaryCard({
  active,
  label,
  onClick,
  tone,
  value,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'muted' | 'success' | 'warning';
  value: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-20 rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/35',
        active && 'border-primary/60 bg-primary/5',
      )}
    >
      <div className="flex h-full min-h-20 flex-col items-center justify-center px-3 py-3 text-center">
        <p className={cn(
          'font-mono text-xl font-bold leading-none',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'muted' && 'text-muted-foreground',
        )}>
          {value}
        </p>
        <p className="mt-1.5 min-h-8 max-w-24 text-balance text-xs leading-4 text-muted-foreground">{label}</p>
      </div>
    </button>
  );
}

function SelectField({
  children,
  className,
  disabled,
  icon,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
        {icon}
        {label}
      </label>
      <div className="relative">
        <select
          className="h-11 w-full appearance-none rounded-md border border-border bg-background px-3 pr-10 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
