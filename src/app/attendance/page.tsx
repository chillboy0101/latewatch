'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type AttendanceStatus = 'present' | 'late' | 'not_checked_in';

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
    status: AttendanceStatus;
  } | null;
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
  totals: {
    late: number;
    notCheckedIn: number;
    present: number;
    totalStaff: number;
  };
}

function todayKey() {
  return format(new Date(), 'yyyy-MM-dd');
}

function statusLabel(status: AttendanceStatus) {
  if (status === 'present') return 'Present';
  if (status === 'late') return 'Late';
  return 'Not checked in';
}

function statusClass(status: AttendanceStatus) {
  if (status === 'present') return 'border-success/25 bg-success/10 text-success';
  if (status === 'late') return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-border bg-muted/20 text-muted-foreground';
}

export default function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
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

  const sortedRows = useMemo(() => {
    const rank: Record<AttendanceStatus, number> = {
      late: 0,
      not_checked_in: 1,
      present: 2,
    };
    return [...(data?.rows || [])].sort((a, b) => rank[a.status] - rank[b.status] || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [data?.rows]);

  return (
    <DashboardLayout title="Attendance">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Total Staff" value={data?.totals.totalStaff ?? 0} />
          <SummaryCard label="Present" value={data?.totals.present ?? 0} tone="success" />
          <SummaryCard label="Late" value={data?.totals.late ?? 0} tone="warning" />
          <SummaryCard label="Not Checked In" value={data?.totals.notCheckedIn ?? 0} tone="muted" />
        </div>

        <Card>
          <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border',
                data?.network.isOfficeNetwork
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-warning/25 bg-warning/10 text-warning',
              )}>
                <Wifi className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    className="text-lg font-semibold"
                    title={data?.network.updatedAt
                      ? `Updated ${new Date(data.network.updatedAt).toLocaleString()} by ${data.network.updatedByEmail || 'admin'}`
                      : undefined}
                  >
                    Office WiFi
                  </h2>
                  <span className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium',
                    data?.network.configured
                      ? data.network.isOfficeNetwork
                        ? 'border-success/25 bg-success/10 text-success'
                        : 'border-warning/25 bg-warning/10 text-warning'
                      : 'border-border bg-muted/20 text-muted-foreground',
                  )}>
                    {data?.network.configured ? (data.network.isOfficeNetwork ? 'Verified' : 'Off network') : 'Not set'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <NetworkMetaChip label="Saved" value={data?.network.allowedIp || 'Not saved'} />
                  <NetworkMetaChip label="Current" value={data?.network.currentIp || '-'} />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Attendance Date</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  className="h-10 w-44"
                />
              </div>
              <Button className="h-10 gap-2" onClick={setCurrentNetwork} disabled={savingNetwork}>
                {savingNetwork ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Set This Network
              </Button>
            </div>
          </div>
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
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Check-In</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Penalty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedRows.map((row) => (
                    <tr key={row.staff.id} className="transition-colors hover:bg-card/50">
                      <td className="px-4 py-3 text-sm font-medium">{row.staff.fullName}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{row.staff.email || 'Not linked'}</td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {row.attendance?.checkInTime ? row.attendance.checkInTime.slice(0, 5) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusClass(row.status))}>
                          {row.status === 'present' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {row.status === 'late' && <Clock className="h-3.5 w-3.5" />}
                          {row.status === 'not_checked_in' && <XCircle className="h-3.5 w-3.5" />}
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {Number(row.attendance?.computedAmount || 0) > 0
                          ? `GHC ${Number(row.attendance?.computedAmount || 0).toFixed(2)}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Recent Check-In Attempts</h2>
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
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'muted' | 'success' | 'warning';
  value: number;
}) {
  return (
    <Card>
      <div className="p-5 text-center">
        <p className={cn(
          'font-mono text-2xl font-bold',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'muted' && 'text-muted-foreground',
        )}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function NetworkMetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
      title={`${label}: ${value}`}
    >
      {label}
      <span className="break-all font-mono font-semibold text-foreground">{value}</span>
    </span>
  );
}
