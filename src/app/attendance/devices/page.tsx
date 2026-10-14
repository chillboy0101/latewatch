'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Minus, RefreshCcw, RotateCcw, Search, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDisplayDateTime } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type DeviceHealthFilter = 'all' | 'attention' | 'trusted' | 'reminder_sent' | 'reminder_failed';

type ReminderMonitorRowStatus =
  | 'failed'
  | 'missing'
  | 'no_trusted_device'
  | 'notifications_not_registered'
  | 'pending'
  | 'reminder_off'
  | 'sent'
  | 'skipped'
  | 'waiting';

interface ReminderMonitorApiRow {
  reason?: string;
  staff: { id: string };
  status: ReminderMonitorRowStatus;
}

interface ReminderMonitorApiSection {
  firstRunAt?: string | null;
  label: string;
  lastRunAt: string | null;
  missedRun?: boolean;
  rows: ReminderMonitorApiRow[];
  scheduledPassed: boolean;
  scheduledTime?: string;
  sentByApp?: boolean;
}

interface CannotReceiveRow {
  fullName: string;
  label: string;
  staffId: string;
  status: 'failing' | 'no_device' | 'not_registered' | 'partly_off' | 'reminders_off';
}

interface ReminderMonitorApiResponse {
  cannotReceive?: CannotReceiveRow[];
  day?: { holidayName: string | null; isHoliday: boolean; isWeekend: boolean };
  sections: {
    signIn: ReminderMonitorApiSection;
    signOut: ReminderMonitorApiSection;
  };
}

interface ReminderRun {
  firstRunAt: string | null;
  missedRun: boolean;
  /** Weekend or holiday: no reminders are due. */
  noRemindersReason: string | null;
  reached: number;
  sentByApp: boolean;
  title: string;
  dueLabel: string;
}

interface ReminderCell {
  reason: string;
  status: ReminderMonitorRowStatus;
}

interface ReminderStatusMaps {
  signIn: Map<string, ReminderCell>;
  signOut: Map<string, ReminderCell>;
}

interface DeviceHealthRow {
  attention: boolean;
  attentionReasons: string[];
  staff: {
    department: string | null;
    email: string | null;
    fullName: string;
    id: string;
    unit: string | null;
  };
  transfer: { pending: number };
  trustedDevice: {
    deviceLabel: string | null;
    lastSeenAt: string | null;
    registered: boolean;
    sessionTracked: boolean;
  };
}

interface DeviceHealthResponse {
  generatedAt: string;
  rows: DeviceHealthRow[];
  summary: { attention: number; staff: number };
}

const EMPTY_REMINDER_MAPS: ReminderStatusMaps = { signIn: new Map(), signOut: new Map() };
const REALTIME_REFRESH_DELAY_MS = 800;

function accraTime(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' });
}

function toReminderRun(section: ReminderMonitorApiSection, title: string, dueLabel: string, noRemindersReason: string | null): ReminderRun {
  return {
    dueLabel,
    firstRunAt: section.firstRunAt ?? section.lastRunAt ?? null,
    missedRun: section.missedRun === true,
    noRemindersReason,
    reached: (section.rows || []).filter((row) => row.status === 'sent').length,
    sentByApp: section.sentByApp === true,
    title,
  };
}

/** One line per reminder: when it went out (the first run, not later catch-ups) and how many it reached. */
function reminderRunStatus(run: ReminderRun): { text: string; tone: 'danger' | 'muted' | 'success' } {
  if (run.noRemindersReason) return { text: `None today · ${run.noRemindersReason}`, tone: 'muted' };
  if (run.missedRun && run.sentByApp && run.firstRunAt) {
    return { text: `Cron missed · app sent ${accraTime(run.firstRunAt)} · ${run.reached} reached`, tone: 'danger' };
  }
  if (run.missedRun) return { text: 'Didn’t run', tone: 'danger' };
  if (run.firstRunAt) return { text: `Sent ${accraTime(run.firstRunAt)} · ${run.reached} reached`, tone: 'success' };
  return { text: `Due ${run.dueLabel}`, tone: 'muted' };
}

const CELL_LABELS: Record<ReminderMonitorRowStatus, string> = {
  failed: 'Failed',
  missing: 'Missed',
  no_trusted_device: 'No phone',
  notifications_not_registered: 'Not on',
  pending: 'Sending',
  reminder_off: 'Off',
  sent: 'Sent',
  skipped: '',
  waiting: 'Due',
};

/** A one-word reminder status; the full reason shows on hover. "Skipped" (nothing was due) is a dash. */
function ReminderStatusCell({ cell }: { cell: ReminderCell | undefined }) {
  if (!cell || cell.status === 'skipped') {
    return (
      <span title={cell?.reason} className="inline-flex items-center text-muted-foreground/70">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  }

  const { status } = cell;
  const tone = status === 'sent'
    ? 'text-success'
    : status === 'failed' || status === 'missing'
      ? 'text-danger'
      : status === 'pending' || status === 'waiting'
        ? 'text-muted-foreground'
        : 'text-warning';
  const Icon = status === 'sent' ? CheckCircle2 : status === 'failed' || status === 'missing' ? XCircle : status === 'pending' || status === 'waiting' ? Clock3 : AlertTriangle;

  return (
    <span title={cell.reason} className={cn('inline-flex items-center gap-1.5 text-xs font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" />
      {CELL_LABELS[status]}
    </span>
  );
}

/** Trusted and nothing to fix: the same rows whose badge reads "Trusted". */
function isTrustedAndHealthy(row: DeviceHealthRow) {
  return row.trustedDevice.registered && row.trustedDevice.sessionTracked && row.transfer.pending === 0;
}

function deviceMatchesFilter(row: DeviceHealthRow, filter: DeviceHealthFilter) {
  if (filter === 'attention') return row.attention;
  if (filter === 'trusted') return isTrustedAndHealthy(row);
  return true;
}

function deviceMatchesQuery(row: DeviceHealthRow, query: string) {
  if (!query) return true;

  return [
    row.staff.fullName,
    row.staff.email || '',
    row.staff.department || '',
    row.staff.unit || '',
    row.trustedDevice.deviceLabel || '',
    ...row.attentionReasons,
  ].join(' ').toLowerCase().includes(query);
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
  tone?: 'danger' | 'muted' | 'neutral' | 'success';
  value: number | string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-lg border border-border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/35',
        active && 'border-primary/60 bg-primary/5',
      )}
    >
      <p className={cn(
        'font-mono text-xl font-bold leading-none',
        tone === 'success' && 'text-success',
        tone === 'danger' && 'text-danger',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {value}
      </p>
      <p className="mt-1.5 text-xs font-medium uppercase text-muted-foreground">{label}</p>
    </button>
  );
}

// The device badge says the main state; extra issues not already covered by it get a small tag.
const DEVICE_BADGE_COVERS = new Set(['No trusted attendance device', 'Device transfer pending']);

function shortIssue(reason: string) {
  if (reason.startsWith('Legacy trusted device')) return { help: 'Ask them to open Check-In on that phone. Reset if they no longer have it.', label: 'Refresh session' };
  if (reason === 'Multiple notification devices') return { help: 'Reset, then turn reminders on again on the trusted phone.', label: 'Several phones' };
  if (reason === 'Recent device security alert') return { help: 'Someone tried this phone for another account. See the Audit Trail.', label: 'Security alert' };
  return { help: reason, label: reason };
}

function DeviceCell({ row }: { row: DeviceHealthRow }) {
  const [label, className] = row.transfer.pending > 0
    ? ['Transfer pending', 'border-warning/25 bg-warning/10 text-warning']
    : !row.trustedDevice.registered
      ? ['No device', 'border-danger/25 bg-danger/10 text-danger']
      : !row.trustedDevice.sessionTracked
        ? ['Refresh session', 'border-warning/25 bg-warning/10 text-warning']
        : ['Trusted', 'border-success/25 bg-success/10 text-success'];
  const title = row.transfer.pending > 0
    ? 'Approve or reject it on Attendance Overview.'
    : !row.trustedDevice.registered
      ? 'They need to link a phone at the office.'
      : row.trustedDevice.lastSeenAt ? `Last seen ${formatDisplayDateTime(row.trustedDevice.lastSeenAt)}` : undefined;
  const extraIssues = row.attentionReasons
    .filter((reason) => !DEVICE_BADGE_COVERS.has(reason) && !reason.startsWith('Legacy trusted device'))
    .map(shortIssue);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span title={title} className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', className)}>{label}</span>
      {extraIssues.map((issue) => (
        <span key={issue.label} title={issue.help} className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          {issue.label}
        </span>
      ))}
    </div>
  );
}

export default function DeviceSessionHealthPage() {
  const [data, setData] = useState<DeviceHealthResponse | null>(null);
  const [reminderMaps, setReminderMaps] = useState<ReminderStatusMaps>(EMPTY_REMINDER_MAPS);
  const [reminderRuns, setReminderRuns] = useState<ReminderRun[]>([]);
  const [cannotReceive, setCannotReceive] = useState<CannotReceiveRow[]>([]);
  const [reminderLoadFailed, setReminderLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<DeviceHealthFilter>('all');
  const [resetTarget, setResetTarget] = useState<DeviceHealthRow | null>(null);
  const [resetError, setResetError] = useState('');
  const [resettingStaffId, setResettingStaffId] = useState<string | null>(null);
  // Newest wins: a slow, older response never replaces data from a newer one.
  const loadCounterRef = useRef(0);
  const appliedLoadRef = useRef(0);

  const applyReminders = useCallback((payload: ReminderMonitorApiResponse) => {
    const toMap = (rows: ReminderMonitorApiRow[] = []) => new Map(rows.map((row) => [row.staff.id, { reason: row.reason || '', status: row.status }]));
    const noRemindersReason = payload.day?.isWeekend
      ? 'weekend'
      : payload.day?.isHoliday ? (payload.day.holidayName || 'holiday') : null;
    setReminderMaps({ signIn: toMap(payload.sections?.signIn?.rows), signOut: toMap(payload.sections?.signOut?.rows) });
    setReminderRuns([
      ...(payload.sections?.signIn ? [toReminderRun(payload.sections.signIn, 'Sign-in reminder', '8:15 AM', noRemindersReason)] : []),
      ...(payload.sections?.signOut ? [toReminderRun(payload.sections.signOut, 'Sign-out reminder', '4:30 PM', noRemindersReason)] : []),
    ]);
    setCannotReceive(Array.isArray(payload.cannotReceive) ? payload.cannotReceive : []);
  }, []);

  const loadData = useCallback(async (signal?: AbortSignal, options?: { silent?: boolean }) => {
    const loadId = ++loadCounterRef.current;
    if (!options?.silent) setLoading(true);

    try {
      const [health, reminders] = await Promise.allSettled([
        fetch('/api/attendance/device-health', { cache: 'no-store', signal }).then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to load device health');
          return payload as DeviceHealthResponse;
        }),
        fetch(`/api/attendance/reminder-monitor?date=${encodeURIComponent(getAccraDateKey())}`, { cache: 'no-store', signal }).then(async (response) => {
          if (!response.ok) throw new Error('Failed to load reminder status');
          return (await response.json()) as ReminderMonitorApiResponse;
        }),
      ]);
      if (signal?.aborted || loadId < appliedLoadRef.current) return;
      appliedLoadRef.current = loadId;

      if (health.status === 'fulfilled') {
        setData(health.value);
        setError('');
      } else if (options?.silent) {
        // A background refresh failed: keep the rows already on screen.
        setError('Could not refresh. Showing the last loaded data.');
      } else {
        setError(health.reason instanceof Error ? health.reason.message : 'Failed to load device health');
        setData(null);
      }

      if (reminders.status === 'fulfilled') {
        applyReminders(reminders.value);
        setReminderLoadFailed(false);
      } else {
        // Say so, rather than showing zeros that look like "all fine".
        setReminderLoadFailed(true);
        if (!options?.silent) {
          setReminderMaps(EMPTY_REMINDER_MAPS);
          setReminderRuns([]);
          setCannotReceive([]);
        }
      }
    } finally {
      if (!signal?.aborted && !options?.silent) setLoading(false);
    }
  }, [applyReminders]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData, refreshKey]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Most changes publish to both channels: wait for the burst to settle, then load once.
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loadData(undefined, { silent: true });
      }, REALTIME_REFRESH_DELAY_MS);
    };
    // Coming back to the tab (say, the next morning) shows today's state, not yesterday's.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };

    (async () => {
      const unsubscribers = await Promise.all(
        ['attendance', 'notifications'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: scheduleRefresh,
          }),
        ),
      );

      if (mounted) {
        cleanups = unsubscribers;
      } else {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      }
    })();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      cleanups.forEach((unsubscribe) => unsubscribe());
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [loadData]);

  // Per person: Failed if either reminder failed or went missing; Sent only when nothing failed.
  const rowReminderFailed = useCallback((row: DeviceHealthRow) => (
    [reminderMaps.signIn.get(row.staff.id)?.status, reminderMaps.signOut.get(row.staff.id)?.status]
      .some((status) => status === 'failed' || status === 'missing')
  ), [reminderMaps]);
  const rowReminderSent = useCallback((row: DeviceHealthRow) => (
    !rowReminderFailed(row) &&
    (reminderMaps.signIn.get(row.staff.id)?.status === 'sent' || reminderMaps.signOut.get(row.staff.id)?.status === 'sent')
  ), [reminderMaps, rowReminderFailed]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      if (!deviceMatchesQuery(row, query)) return false;
      if (healthFilter === 'reminder_sent') return rowReminderSent(row);
      if (healthFilter === 'reminder_failed') return rowReminderFailed(row);
      return deviceMatchesFilter(row, healthFilter);
    });
  }, [data?.rows, healthFilter, searchQuery, rowReminderFailed, rowReminderSent]);

  const derivedCounts = useMemo(() => {
    const rows = data?.rows || [];
    return {
      trusted: rows.filter(isTrustedAndHealthy).length,
      reminderSent: rows.filter(rowReminderSent).length,
      reminderFailed: rows.filter(rowReminderFailed).length,
    };
  }, [data?.rows, rowReminderFailed, rowReminderSent]);

  async function resetDevice() {
    if (!resetTarget) return;

    setResettingStaffId(resetTarget.staff.id);
    setResetError('');
    setNotice('');

    try {
      const response = await fetch(`/api/attendance/devices/${resetTarget.staff.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not reset device');

      setNotice(`${resetTarget.staff.fullName}'s device was reset. They'll link a phone and turn reminders on again.`);
      setResetTarget(null);
      await loadData();
    } catch (err) {
      console.error('Failed to reset attendance device:', err);
      // Shown inside the dialog, where the admin is looking.
      setResetError(err instanceof Error ? err.message : 'Could not reset device');
    } finally {
      setResettingStaffId(null);
    }
  }

  return (
    <DashboardLayout title="Devices">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search staff"
              aria-label="Search staff"
              className="h-10 pl-9"
            />
          </div>
          {data?.generatedAt && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">Updated {accraTime(data.generatedAt)}</span>
          )}
          <Button
            className="h-10 shrink-0 gap-2"
            variant="outline"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <SummaryFilter active={healthFilter === 'all'} label="Staff" value={data.summary.staff} onClick={() => setHealthFilter('all')} />
            <SummaryFilter active={healthFilter === 'trusted'} label="Trusted" value={derivedCounts.trusted} tone="success" onClick={() => setHealthFilter('trusted')} />
            <SummaryFilter active={healthFilter === 'attention'} label="Attention" value={data.summary.attention} tone={data.summary.attention ? 'danger' : 'muted'} onClick={() => setHealthFilter('attention')} />
            <SummaryFilter active={healthFilter === 'reminder_sent'} label="Reminded" value={reminderLoadFailed ? '—' : derivedCounts.reminderSent} tone="success" onClick={() => setHealthFilter('reminder_sent')} />
            <SummaryFilter active={healthFilter === 'reminder_failed'} label="Failed" value={reminderLoadFailed ? '—' : derivedCounts.reminderFailed} tone={derivedCounts.reminderFailed ? 'danger' : 'muted'} onClick={() => setHealthFilter('reminder_failed')} />
          </div>
        )}

        {reminderRuns.length > 0 && (
          <Card className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0" aria-label="Today's reminders">
            {reminderRuns.map((run) => {
              const status = reminderRunStatus(run);
              const Icon = status.tone === 'success' ? CheckCircle2 : status.tone === 'danger' ? AlertTriangle : Clock3;
              return (
                <div key={run.title} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium">{run.title}</span>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 text-sm',
                    status.tone === 'success' && 'text-success',
                    status.tone === 'danger' && 'font-medium text-danger',
                    status.tone === 'muted' && 'text-muted-foreground',
                  )}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {status.text}
                  </span>
                </div>
              );
            })}
          </Card>
        )}

        {reminderLoadFailed && (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
            Couldn&apos;t load today&apos;s reminders. Refresh to try again.
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
            {notice}
          </div>
        )}

        {cannotReceive.length > 0 && (
          <Card className="px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Can&apos;t get reminders · {cannotReceive.length}
            </h2>
            <ul className="mt-2 grid gap-x-10 gap-y-1.5 lg:grid-cols-2">
              {cannotReceive.map((row) => (
                <li key={row.staffId} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <span className="truncate">{row.fullName}</span>
                  <span className={cn('shrink-0 text-xs font-medium', row.status === 'failing' ? 'text-danger' : 'text-warning')}>
                    {row.label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {loading && !data ? (
          <Card className="flex h-52 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading devices" />
          </Card>
        ) : data ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Staff</th>
                    <th className="px-4 py-3 font-medium">Device</th>
                    <th className="w-28 px-4 py-3 font-medium">Sign-in</th>
                    <th className="w-28 px-4 py-3 font-medium">Sign-out</th>
                    <th className="w-24 px-4 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                        No one here.
                      </td>
                    </tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.staff.id} className="transition-colors hover:bg-card/50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{row.staff.fullName}</div>
                        {row.staff.department && <div className="text-xs text-muted-foreground">{row.staff.department}</div>}
                      </td>
                      <td className="px-4 py-2.5"><DeviceCell row={row} /></td>
                      <td className="px-4 py-2.5"><ReminderStatusCell cell={reminderMaps.signIn.get(row.staff.id)} /></td>
                      <td className="px-4 py-2.5"><ReminderStatusCell cell={reminderMaps.signOut.get(row.staff.id)} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {/* Nothing to reset without a linked device. */}
                        {row.trustedDevice.registered && (
                          <Button
                            className="h-8 gap-1.5 px-2"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setResetError('');
                              setResetTarget(row);
                            }}
                            disabled={resettingStaffId === row.staff.id}
                          >
                            {resettingStaffId === row.staff.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Reset
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Dialog
          open={Boolean(resetTarget)}
          onOpenChange={(open) => {
            if (!open && !resettingStaffId) setResetTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset {resetTarget?.staff.fullName || 'device'}?</DialogTitle>
              <DialogDescription>
                They&apos;re signed out everywhere and reminders switch off. They link a phone again at the office.
              </DialogDescription>
            </DialogHeader>
            {resetError && (
              <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {resetError}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetTarget(null)} disabled={Boolean(resettingStaffId)}>
                Cancel
              </Button>
              <Button className="gap-2" onClick={resetDevice} disabled={Boolean(resettingStaffId)}>
                {resettingStaffId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
