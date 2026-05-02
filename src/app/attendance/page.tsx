'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Printer, QrCode, RotateCcw, ShieldCheck, Smartphone, Trash2, Wifi, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import {
  ATTENDANCE_PERMISSION_WINDOWS,
  getPermissionWindowBounds,
} from '@/lib/attendance-permissions';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type AttendanceStatus = 'present' | 'late' | 'excused' | 'expected_late' | 'permission_overdue' | 'no_sign_out' | 'not_checked_in';
type AttendanceFilter = 'all' | AttendanceStatus;

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
    id: string | null;
    lastSeenAt: string | null;
    registered: boolean;
    registeredAt: string | null;
  };
  permission: AttendancePermission | null;
  status: AttendanceStatus;
}

interface AttendanceAttempt {
  id: string;
  createdAt: string;
  result: string;
  successful: boolean;
  userEmail: string;
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
  totals: {
    excused: number;
    expectedLate: number;
    late: number;
    noSignOut: number;
    notCheckedIn: number;
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
  return format(new Date(), 'yyyy-MM-dd');
}

function statusLabel(status: AttendanceStatus) {
  if (status === 'present') return 'Present';
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

export default function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [activeFilter, setActiveFilter] = useState<AttendanceFilter>('all');
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState<AttendanceQrResponse | null>(null);
  const [permissionStaffId, setPermissionStaffId] = useState('');
  const [permissionType, setPermissionType] = useState('late_arrival');
  const [permissionWindow, setPermissionWindow] = useState('any_time_today');
  const [permissionExpectedTime, setPermissionExpectedTime] = useState('10:30');
  const [permissionReason, setPermissionReason] = useState('');
  const [savingPermission, setSavingPermission] = useState(false);
  const [deletingPermissionId, setDeletingPermissionId] = useState<string | null>(null);
  const [resettingDeviceStaffId, setResettingDeviceStaffId] = useState<string | null>(null);
  const [savingNetwork, setSavingNetwork] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/attendance?date=${selectedDate}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Attendance request failed (${response.status})`);
      setData(await response.json());
    } catch (err) {
      console.error('Failed to load attendance:', err);
      setError(err instanceof Error ? err.message : 'Could not load attendance');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

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
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'dashboard',
        events: ['invalidate'],
        onEvent: fetchAttendance,
      });

      if (mounted) {
        cleanup = unsubscribe;
      } else {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchAttendance]);

  async function setCurrentNetwork() {
    setSavingNetwork(true);
    setError(null);

    try {
      const response = await fetch('/api/attendance/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Office WiFi' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Network update failed (${response.status})`);
      }
      await fetchAttendance();
    } catch (err) {
      console.error('Failed to update office network:', err);
      setError(err instanceof Error ? err.message : 'Could not update office network');
    } finally {
      setSavingNetwork(false);
    }
  }

  async function savePermission() {
    if (!permissionStaffId || !permissionReason.trim()) {
      setError('Select a staff member and enter the permission reason.');
      return;
    }

    setSavingPermission(true);
    setError(null);

    try {
      const response = await fetch('/api/attendance/permissions', {
        body: JSON.stringify({
          arrivalWindow: permissionWindow,
          date: selectedDate,
          expectedEndTime: permissionWindow === 'specific_time' ? permissionExpectedTime : null,
          permissionType,
          reason: permissionReason,
          staffId: permissionStaffId,
        }),
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

  async function resetDevice(staffId: string) {
    setResettingDeviceStaffId(staffId);
    setError(null);

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
            <p>Scan to check in or check out.</p>
            <div class="qr">${qrData.qrSvg}</div>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  const sortedRows = useMemo(() => {
    const rank: Record<AttendanceStatus, number> = {
      permission_overdue: 0,
      late: 1,
      no_sign_out: 2,
      not_checked_in: 3,
      expected_late: 4,
      excused: 5,
      present: 6,
    };
    const rows = activeFilter === 'all'
      ? data?.rows || []
      : (data?.rows || []).filter((row) => row.status === activeFilter);

    return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [activeFilter, data?.rows]);

  return (
    <DashboardLayout title="Attendance">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
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

        <Card>
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] xl:items-end">
            <div className="flex min-w-0 items-center gap-3 xl:self-center">
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border',
                data?.network.isOfficeNetwork
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-warning/25 bg-warning/10 text-warning',
              )}>
                <Wifi className="h-5 w-5" />
              </div>
              <div className="flex min-w-0 items-center">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2
                    className="text-lg font-semibold leading-none"
                    title={data?.network.updatedAt
                      ? `Updated ${new Date(data.network.updatedAt).toLocaleString()} by ${data.network.updatedByEmail || 'admin'}`
                      : undefined}
                  >
                    Office WiFi
                  </h2>
                  {data?.network.isOfficeNetwork ? (
                    <VerifiedBadge />
                  ) : (
                    <UnverifiedBadge />
                  )}
                </div>
              </div>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_auto]">
              <NetworkMetaChip label="Saved IP" value={formatNetworkIp(data?.network.allowedIp || 'Not saved')} />
              <NetworkMetaChip label="Current IP" value={formatNetworkIp(data?.network.currentIp || '-')} />
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Attendance Date</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  className="h-10 w-full"
                />
              </div>
              <Button className="h-10 gap-2 md:self-end" onClick={setCurrentNetwork} disabled={savingNetwork}>
                {savingNetwork ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Set This Network
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-white" aria-label="Permanent attendance QR code">
                {qrData?.qrSvg ? (
                  <div className="h-full w-full [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrData.qrSvg }} />
                ) : (
                  <QrCode className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Attendance QR</h2>
                <p className="mt-1 text-sm text-muted-foreground">Scan to check in or check out.</p>
              </div>
            </div>
            <Button className="h-10 gap-2 md:self-center" onClick={printOfficeQr} disabled={!qrData?.qrSvg}>
              <Printer className="h-4 w-4" />
              Print QR
            </Button>
          </div>
        </Card>

        <Card>
          <div className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_10rem_12rem_minmax(220px,1fr)_auto] lg:items-end">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Staff</label>
              <select
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/35"
                value={permissionStaffId}
                onChange={(event) => setPermissionStaffId(event.target.value)}
              >
                <option value="">Select staff</option>
                {(data?.rows || []).map((row) => (
                  <option key={row.staff.id} value={row.staff.id}>{row.staff.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Permission</label>
              <select
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/35"
                value={permissionType}
                onChange={(event) => {
                  setPermissionType(event.target.value);
                  if (event.target.value === 'absence') setPermissionWindow('any_time_today');
                }}
              >
                <option value="late_arrival">Late arrival</option>
                <option value="absence">Excused absence</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Arrival Window</label>
              <select
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-60"
                value={permissionWindow}
                onChange={(event) => setPermissionWindow(event.target.value)}
                disabled={permissionType === 'absence'}
              >
                {ATTENDANCE_PERMISSION_WINDOWS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {permissionType === 'late_arrival' && permissionWindow === 'specific_time' && (
                <Input
                  className="mt-2 h-10"
                  type="time"
                  value={permissionExpectedTime}
                  onChange={(event) => setPermissionExpectedTime(event.target.value)}
                />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Reason</label>
              <Input
                className="h-10"
                placeholder="Approved reason"
                value={permissionReason}
                onChange={(event) => setPermissionReason(event.target.value)}
              />
            </div>
            <Button className="h-10 gap-2" onClick={savePermission} disabled={savingPermission}>
              {savingPermission ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Approve
            </Button>
          </div>
          {(data?.permissions || []).length > 0 && (
            <div className="divide-y divide-border border-t border-border">
              {data?.permissions.map((permission) => (
                <div key={permission.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{permission.staffName || 'Staff member'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {permission.permissionType === 'absence'
                        ? 'Excused absence'
                        : `Late arrival / ${getPermissionWindowBounds(permission).label}`} / {permission.reason}
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

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
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
                  {sortedRows.map((row) => (
                    <tr key={row.staff.id} className="transition-colors hover:bg-card/50">
                      <td className="px-4 py-3 text-sm font-medium">{row.staff.fullName}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{row.staff.email || 'Not linked'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
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
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusClass(row.status))}>
                          {row.status === 'present' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {row.status === 'late' && <Clock className="h-3.5 w-3.5" />}
                          {row.status === 'excused' && <ShieldCheck className="h-3.5 w-3.5" />}
                          {row.status === 'expected_late' && <Clock className="h-3.5 w-3.5" />}
                          {row.status === 'permission_overdue' && <AlertTriangle className="h-3.5 w-3.5" />}
                          {row.status === 'no_sign_out' && <AlertTriangle className="h-3.5 w-3.5" />}
                          {row.status === 'not_checked_in' && <XCircle className="h-3.5 w-3.5" />}
                          {statusLabel(row.status)}
                        </span>
                        {row.permission && (
                          <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground" title={row.permission.reason}>
                            {row.permission.permissionType === 'absence'
                              ? row.permission.reason
                              : `${getPermissionWindowBounds(row.permission).label} / ${row.permission.reason}`}
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
                  {sortedRows.length === 0 && (
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
        'rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/35',
        active && 'border-primary/60 bg-primary/5',
      )}
    >
      <div className="p-5 text-center">
        <p className={cn(
          'font-mono text-2xl font-bold',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'muted' && 'text-muted-foreground',
        )}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </button>
  );
}

function formatNetworkIp(value: string) {
  if (value === '::1') return 'Localhost (::1)';
  if (value === '127.0.0.1') return 'Localhost (127.0.0.1)';
  if (value === 'local') return 'Localhost';
  return value;
}

function VerifiedBadge() {
  return (
    <svg
      aria-label="Verified office network"
      className="h-5 w-5 shrink-0"
      role="img"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 1.6 14.1 3.4 16.8 2.9 18.1 5.3 20.8 6.1 20.9 8.9 23 10.7 21.8 13.2 22.6 15.9 20.1 17.2 19.3 19.9 16.5 20 14.7 22.1 12 21 9.3 22.1 7.5 20 4.7 19.9 3.9 17.2 1.4 15.9 2.2 13.2 1 10.7 3.1 8.9 3.2 6.1 5.9 5.3 7.2 2.9 9.9 3.4 12 1.6Z"
        fill="#1d9bf0"
      />
      <path
        d="m10.35 14.55 5.55-6.05 1.55 1.42-6.95 7.58-4.05-4.05 1.48-1.48 2.42 2.58Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function UnverifiedBadge() {
  return (
    <svg
      aria-label="Unverified office network"
      className="h-5 w-5 shrink-0"
      role="img"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 1.6 14.1 3.4 16.8 2.9 18.1 5.3 20.8 6.1 20.9 8.9 23 10.7 21.8 13.2 22.6 15.9 20.1 17.2 19.3 19.9 16.5 20 14.7 22.1 12 21 9.3 22.1 7.5 20 4.7 19.9 3.9 17.2 1.4 15.9 2.2 13.2 1 10.7 3.1 8.9 3.2 6.1 5.9 5.3 7.2 2.9 9.9 3.4 12 1.6Z"
        fill="#ef4444"
      />
      <path
        d="m8.55 7.1 3.45 3.45 3.45-3.45 1.45 1.45L13.45 12l3.45 3.45-1.45 1.45L12 13.45 8.55 16.9 7.1 15.45 10.55 12 7.1 8.55 8.55 7.1Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function NetworkMetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0" title={`${label}: ${value}`}>
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="flex min-h-10 items-center rounded-md border border-border bg-background px-3 py-2">
        <span className="break-all font-mono text-xs font-semibold leading-5 text-foreground">{value}</span>
      </div>
    </div>
  );
}
