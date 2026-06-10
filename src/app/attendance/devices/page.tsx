'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCcw, Shield, Smartphone } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDisplayDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';

interface DeviceHealthRow {
  attention: boolean;
  attentionReasons: string[];
  reminders: {
    activeSubscriptions: number;
    disabledSubscriptions: number;
    lastUpdatedAt: string | null;
    signInEnabled: number;
    signOutEnabled: number;
  };
  security: {
    latestAlertAt: string | null;
    latestResetAt: string | null;
    latestTransferReviewAt: string | null;
    revokedSessions: number;
  };
  staff: {
    department: string | null;
    email: string | null;
    fullName: string;
    id: string;
    isAttendanceOnly: boolean;
    unit: string | null;
  };
  transfer: {
    latestRequestedAt: string | null;
    latestReviewedAt: string | null;
    latestStatus: string | null;
    pending: number;
    requestedByEmail: string | null;
  };
  trustedDevice: {
    deviceLabel: string | null;
    id: string | null;
    lastDistanceMeters: string | null;
    lastSeenAt: string | null;
    lastVerificationMethod: string | null;
    lastVerifiedAt: string | null;
    registered: boolean;
    registeredAt: string | null;
    sessionTracked: boolean;
    updatedAt: string | null;
  };
}

interface DeviceHealthResponse {
  generatedAt: string;
  rows: DeviceHealthRow[];
  summary: {
    activeReminderDevices: number;
    attention: number;
    pendingTransfers: number;
    registeredDevices: number;
    sessionTrackedDevices: number;
    staff: number;
  };
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'danger' | 'muted' | 'neutral' | 'success' | 'warning' }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      tone === 'success' && 'border-success/25 bg-success/10 text-success',
      tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'muted' && 'border-border bg-muted/15 text-muted-foreground',
      tone === 'neutral' && 'border-border bg-card text-foreground',
    )}>
      <p className="text-xs font-medium uppercase text-current/75">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none">{value}</p>
    </div>
  );
}

function DeviceStatusBadge({ row }: { row: DeviceHealthRow }) {
  if (!row.trustedDevice.registered) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger">
        <AlertTriangle className="h-3.5 w-3.5" />
        No trusted device
      </span>
    );
  }

  if (!row.trustedDevice.sessionTracked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
        <Clock3 className="h-3.5 w-3.5" />
        Session not tracked
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Trusted
    </span>
  );
}

export default function DeviceSessionHealthPage() {
  const [data, setData] = useState<DeviceHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/attendance/device-health', {
        cache: 'no-store',
        signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load device health');
      setData(payload);
    } catch (loadError) {
      if ((loadError as Error).name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load device health');
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData, refreshKey]);

  return (
    <DashboardLayout title="Device Health">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Device + Session Health</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Trusted attendance devices, reminder devices, transfer state, and session cleanup.
            </p>
          </div>
          <Button
            className="h-10 gap-2 self-start xl:self-auto"
            variant="outline"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading && !data ? (
          <Card className="flex h-52 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading device health
            </div>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-6 gap-3">
              <SummaryMetric label="Staff" value={data.summary.staff} />
              <SummaryMetric label="Trusted" value={data.summary.registeredDevices} tone="success" />
              <SummaryMetric label="Tracked" value={data.summary.sessionTrackedDevices} tone="success" />
              <SummaryMetric label="Reminder Devices" value={data.summary.activeReminderDevices} />
              <SummaryMetric label="Transfers" value={data.summary.pendingTransfers} tone={data.summary.pendingTransfers ? 'warning' : 'muted'} />
              <SummaryMetric label="Attention" value={data.summary.attention} tone={data.summary.attention ? 'danger' : 'muted'} />
            </div>

            <Card className="overflow-hidden">
              <div className="border-b border-border p-5">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-semibold">Staff Device Status</h2>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium">Trusted Device</th>
                      <th className="px-4 py-3 font-medium">Reminder Devices</th>
                      <th className="px-4 py-3 font-medium">Transfer</th>
                      <th className="px-4 py-3 font-medium">Security</th>
                      <th className="px-4 py-3 font-medium">Attention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.rows.map((row) => (
                      <tr key={row.staff.id} className="hover:bg-muted/15">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.staff.fullName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[row.staff.department, row.staff.unit].filter(Boolean).join(' / ') || row.staff.email || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <DeviceStatusBadge row={row} />
                          <div className="mt-2 text-xs text-muted-foreground">
                            Last seen: {row.trustedDevice.lastSeenAt ? formatDisplayDateTime(row.trustedDevice.lastSeenAt) : '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.reminders.activeSubscriptions} active / {row.reminders.disabledSubscriptions} disabled</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.reminders.signInEnabled} sign-in, {row.reminders.signOutEnabled} sign-out enabled
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.transfer.pending} pending</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Latest: {row.transfer.latestStatus || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.security.revokedSessions} revoked sessions</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Reset: {row.security.latestResetAt ? formatDisplayDateTime(row.security.latestResetAt) : '-'}
                          </div>
                        </td>
                        <td className="max-w-xs px-4 py-3 align-top">
                          {row.attentionReasons.length > 0 ? (
                            <div className="space-y-1">
                              {row.attentionReasons.map((reason) => (
                                <div key={reason} className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                                  <Shield className="h-3 w-3" />
                                  {reason}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Clear</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
