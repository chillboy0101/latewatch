'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Loader2, RefreshCcw, RotateCcw, Search, Shield } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDisplayDateTime } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type DeviceHealthFilter = 'all' | 'attention' | 'trusted' | 'missing' | 'session_untracked' | 'pending_transfer' | 'multiple_reminders';

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

function staffMeta(row: DeviceHealthRow) {
  return [row.staff.department, row.staff.unit].filter(Boolean).join(' / ') || row.staff.email || '-';
}

function deviceMatchesFilter(row: DeviceHealthRow, filter: DeviceHealthFilter) {
  if (filter === 'all') return true;
  if (filter === 'attention') return row.attention;
  if (filter === 'trusted') return row.trustedDevice.registered;
  if (filter === 'missing') return !row.trustedDevice.registered;
  if (filter === 'session_untracked') return row.trustedDevice.registered && !row.trustedDevice.sessionTracked;
  if (filter === 'pending_transfer') return row.transfer.pending > 0;
  return row.reminders.activeSubscriptions > 1;
}

function deviceMatchesQuery(row: DeviceHealthRow, query: string) {
  if (!query) return true;

  return [
    row.staff.fullName,
    row.staff.email || '',
    row.staff.department || '',
    row.staff.unit || '',
    row.trustedDevice.deviceLabel || '',
    row.transfer.latestStatus || '',
    ...row.attentionReasons,
  ].join(' ').toLowerCase().includes(query);
}

function SelectField({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: DeviceHealthFilter) => void;
  value: DeviceHealthFilter;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/35"
          value={value}
          onChange={(event) => onChange(event.target.value as DeviceHealthFilter)}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

function SummaryFilter({
  active,
  label,
  onClick,
  tone = 'neutral',
  value,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'muted' | 'neutral' | 'success' | 'warning';
  value: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-20 rounded-lg border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/35',
        active && 'border-primary/60 bg-primary/5',
      )}
    >
      <p className={cn(
        'font-mono text-xl font-bold leading-none',
        tone === 'success' && 'text-success',
        tone === 'danger' && 'text-danger',
        tone === 'warning' && 'text-warning',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {value}
      </p>
      <p className="mt-1.5 text-xs font-medium uppercase text-muted-foreground">{label}</p>
    </button>
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
        Session needs refresh
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

function issueHelpText(reason: string) {
  if (reason.startsWith('Legacy trusted device')) {
    return 'Ask the staff member to open Check-In on that trusted device. Reset if they no longer have it.';
  }

  if (reason === 'Multiple notification devices') {
    return 'Reset the device to disable old notification devices, then enable reminders again on the trusted device.';
  }

  if (reason === 'No trusted attendance device') {
    return 'Staff must link a trusted device at the office or request a device transfer.';
  }

  if (reason === 'Device transfer pending') {
    return 'Review the pending transfer before the staff member can use the new device.';
  }

  if (reason === 'Recent device security alert') {
    return 'Open Security Alerts to inspect the blocked attempt.';
  }

  return '';
}

export default function DeviceSessionHealthPage() {
  const [data, setData] = useState<DeviceHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<DeviceHealthFilter>('all');
  const [resetTarget, setResetTarget] = useState<DeviceHealthRow | null>(null);
  const [resettingStaffId, setResettingStaffId] = useState<string | null>(null);

  const loadData = useCallback(async (signal?: AbortSignal, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
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
      if (!signal?.aborted && !options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData, refreshKey]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['attendance', 'notifications'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: () => loadData(undefined, { silent: true }),
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
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (data?.rows || [])
      .filter((row) => deviceMatchesQuery(row, query) && deviceMatchesFilter(row, healthFilter));
  }, [data?.rows, healthFilter, searchQuery]);

  const derivedCounts = useMemo(() => {
    const rows = data?.rows || [];
    return {
      missing: rows.filter((row) => !row.trustedDevice.registered).length,
      multipleReminderDevices: rows.filter((row) => row.reminders.activeSubscriptions > 1).length,
      sessionRefresh: rows.filter((row) => row.trustedDevice.registered && !row.trustedDevice.sessionTracked).length,
      trusted: rows.filter((row) => row.trustedDevice.registered).length,
    };
  }, [data?.rows]);

  async function resetDevice() {
    if (!resetTarget) return;

    setResettingStaffId(resetTarget.staff.id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/api/attendance/devices/${resetTarget.staff.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not reset device');

      const disabledCount = Number(body.disabledPushSubscriptions || 0);
      const revokedCount = Number(body.revokedSessions || 0);
      const resetCopy = body.reset === false ? 'No trusted attendance device was registered.' : 'Attendance device reset.';
      setNotice(`${resetTarget.staff.fullName}: ${resetCopy} ${disabledCount} notification device${disabledCount === 1 ? '' : 's'} disabled and ${revokedCount} login session${revokedCount === 1 ? '' : 's'} revoked.`);
      setResetTarget(null);
      await loadData();
    } catch (err) {
      console.error('Failed to reset attendance device:', err);
      setError(err instanceof Error ? err.message : 'Could not reset device');
    } finally {
      setResettingStaffId(null);
    }
  }

  return (
    <DashboardLayout title="Device Health">
      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(18rem,1fr)_13rem_7.5rem] xl:items-end">
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search staff, email, device, or issue"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <SelectField label="Health" value={healthFilter} onChange={setHealthFilter}>
              <option value="all">All staff</option>
              <option value="attention">Needs attention</option>
              <option value="trusted">Trusted device</option>
              <option value="missing">No trusted device</option>
              <option value="session_untracked">Session needs refresh</option>
              <option value="pending_transfer">Pending transfer</option>
              <option value="multiple_reminders">Multiple notification devices</option>
            </SelectField>
            <Button
              className="h-10 w-full gap-2 xl:self-end"
              variant="outline"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
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

        {loading && !data ? (
          <Card className="flex h-52 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading device health
            </div>
          </Card>
        ) : data ? (
          <>
            <div className="grid auto-cols-[minmax(8rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-7 xl:overflow-visible xl:pb-0">
              <SummaryFilter active={healthFilter === 'all'} label="Staff" value={data.summary.staff} onClick={() => setHealthFilter('all')} />
              <SummaryFilter active={healthFilter === 'trusted'} label="Trusted" value={derivedCounts.trusted} tone="success" onClick={() => setHealthFilter('trusted')} />
              <SummaryFilter active={healthFilter === 'attention'} label="Attention" value={data.summary.attention} tone={data.summary.attention ? 'danger' : 'muted'} onClick={() => setHealthFilter('attention')} />
              <SummaryFilter active={healthFilter === 'missing'} label="No Trusted" value={derivedCounts.missing} tone={derivedCounts.missing ? 'warning' : 'muted'} onClick={() => setHealthFilter('missing')} />
              <SummaryFilter active={healthFilter === 'pending_transfer'} label="Transfers" value={data.summary.pendingTransfers} tone={data.summary.pendingTransfers ? 'warning' : 'muted'} onClick={() => setHealthFilter('pending_transfer')} />
              <SummaryFilter active={healthFilter === 'session_untracked'} label="Refresh Session" value={derivedCounts.sessionRefresh} tone={derivedCounts.sessionRefresh ? 'warning' : 'muted'} onClick={() => setHealthFilter('session_untracked')} />
              <SummaryFilter active={healthFilter === 'multiple_reminders'} label="Multiple Notifications" value={derivedCounts.multipleReminderDevices} tone={derivedCounts.multipleReminderDevices ? 'warning' : 'muted'} onClick={() => setHealthFilter('multiple_reminders')} />
            </div>

            <Card className="overflow-hidden">
              {data.generatedAt && (
                <div className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
                  Last updated {formatDisplayDateTime(data.generatedAt)}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium">Trusted Device</th>
                      <th className="px-4 py-3 font-medium">Reminder Devices</th>
                      <th className="px-4 py-3 font-medium">Transfer</th>
                      <th className="px-4 py-3 font-medium">Security</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                          No staff device rows in this filter.
                        </td>
                      </tr>
                    ) : filteredRows.map((row) => (
                      <tr key={row.staff.id} className="transition-colors hover:bg-card/50">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.staff.fullName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{staffMeta(row)}</div>
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
                        <td className="max-w-xs px-4 py-3 align-top">
                          <div className="font-medium">{row.security.revokedSessions} revoked sessions</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Reset: {row.security.latestResetAt ? formatDisplayDateTime(row.security.latestResetAt) : '-'}
                          </div>
                          {row.attentionReasons.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {row.attentionReasons.map((reason) => (
                                <div key={reason}>
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                                    <Shield className="h-3 w-3" />
                                    {reason}
                                  </span>
                                  {issueHelpText(reason) && (
                                    <div className="mt-1 text-xs text-muted-foreground">{issueHelpText(reason)}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Button
                            className="h-8 gap-1.5 px-2"
                            size="sm"
                            variant="outline"
                            onClick={() => setResetTarget(row)}
                            disabled={resettingStaffId === row.staff.id}
                          >
                            {resettingStaffId === row.staff.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Reset
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}

        <Dialog
          open={Boolean(resetTarget)}
          onOpenChange={(open) => {
            if (!open && !resettingStaffId) setResetTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset attendance device</DialogTitle>
              <DialogDescription>
                {resetTarget?.staff.fullName || 'This staff member'} will be signed out of old sessions, old notification devices will be disabled, and reminders must be enabled again on the trusted device.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              This is a security action. Use it only when the staff member should start fresh on a trusted device.
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetTarget(null)} disabled={Boolean(resettingStaffId)}>
                Cancel
              </Button>
              <Button className="gap-2" onClick={resetDevice} disabled={Boolean(resettingStaffId)}>
                {resettingStaffId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reset Device
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
