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
type AttendanceFilter = 'all' | AttendanceStatus;

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
  const [activeFilter, setActiveFilter] = useState<AttendanceFilter>('all');
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
    const rows = activeFilter === 'all'
      ? data?.rows || []
      : (data?.rows || []).filter((row) => row.status === activeFilter);

    return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [activeFilter, data?.rows]);

  return (
    <DashboardLayout title="Attendance">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            active={activeFilter === 'not_checked_in'}
            label="Not Checked In"
            onClick={() => setActiveFilter('not_checked_in')}
            tone="muted"
            value={data?.totals.notCheckedIn ?? 0}
          />
        </div>

        <Card>
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
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
                    <span className="text-xs font-medium text-muted-foreground">
                      Unknown
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_auto] xl:min-w-[48rem]">
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
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
  active,
  label,
  onClick,
  tone,
  value,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: 'muted' | 'success' | 'warning';
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
