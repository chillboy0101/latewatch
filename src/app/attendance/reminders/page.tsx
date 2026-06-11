'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, Clock3, Loader2, RefreshCcw, Search, Smartphone, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

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
type ReminderStatusFilter =
  | 'all'
  | 'needs_review'
  | 'no_trusted_device'
  | 'notifications_not_registered'
  | 'pending'
  | 'reminder_off'
  | 'sent'
  | 'skipped';
type ReminderMonitorType = 'sign_in' | 'sign_out';
type ReminderTypeKey = 'signIn' | 'signOut';

interface ReminderMonitorRow {
  activeReminderDevices: number;
  delivery: {
    disabled: number;
    failed: number;
    latestError: string | null;
    latestSentAt: string | null;
    pending: number;
    sent: number;
  };
  enabledReminderDevices: number;
  eligible: boolean;
  reminderType: ReminderMonitorType;
  reason: string;
  staff: {
    department: string | null;
    email: string | null;
    fullName: string;
    id: string;
    unit: string | null;
  };
  status: ReminderMonitorRowStatus;
  tone: 'success' | 'danger' | 'warning' | 'muted' | 'neutral';
}

interface ReminderMonitorSection {
  alerts: Array<{
    message: string;
    tone: 'danger' | 'warning';
  }>;
  label: string;
  reminderType: string;
  rows: ReminderMonitorRow[];
  scheduledPassed: boolean;
  scheduledTime: string;
  summary: {
    eligible: number;
    failed: number;
    missing: number;
    noTrustedDevice: number;
    notificationsNotRegistered: number;
    pending: number;
    reminderOff: number;
    sent: number;
    skipped: number;
    waiting: number;
  };
}

interface ReminderMonitorResponse {
  date: string;
  day: {
    holidayName: string | null;
    isHoliday: boolean;
    isWeekend: boolean;
  };
  generatedAt: string;
  sections: Record<ReminderTypeKey, ReminderMonitorSection>;
  totalStaff: number;
}

function statusLabel(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Pending';
  if (status === 'missing') return 'Missing';
  if (status === 'waiting') return 'Waiting';
  if (status === 'no_trusted_device') return 'No trusted device';
  if (status === 'notifications_not_registered') return 'Notifications not registered';
  if (status === 'reminder_off') return 'Reminder off';
  return 'Skipped';
}

function statusClass(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'border-success/25 bg-success/10 text-success';
  if (status === 'failed' || status === 'missing') return 'border-danger/25 bg-danger/10 text-danger';
  if (status === 'pending' || status === 'waiting' || status === 'no_trusted_device' || status === 'notifications_not_registered') return 'border-warning/25 bg-warning/10 text-warning';
  if (status === 'reminder_off') return 'border-border bg-muted/20 text-muted-foreground';
  return 'border-border bg-card text-muted-foreground';
}

function StatusIcon({ status }: { status: ReminderMonitorRowStatus }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'failed' || status === 'missing') return <XCircle className="h-3.5 w-3.5" />;
  if (status === 'pending' || status === 'waiting') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'no_trusted_device' || status === 'notifications_not_registered' || status === 'reminder_off') return <Smartphone className="h-3.5 w-3.5" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

function rowMatchesFilter(row: ReminderMonitorRow, filter: ReminderStatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'needs_review') return row.status === 'failed' || row.status === 'missing';
  if (filter === 'pending') return row.status === 'pending' || row.status === 'waiting';
  return row.status === filter;
}

function rowMatchesQuery(row: ReminderMonitorRow, query: string) {
  if (!query) return true;

  return [
    row.staff.fullName,
    row.staff.email || '',
    row.staff.department || '',
    row.staff.unit || '',
    row.reason,
    statusLabel(row.status),
  ].join(' ').toLowerCase().includes(query);
}

function filterSection(section: ReminderMonitorSection, query: string, statusFilter: ReminderStatusFilter): ReminderMonitorSection {
  return {
    ...section,
    rows: section.rows.filter((row) => rowMatchesQuery(row, query) && rowMatchesFilter(row, statusFilter)),
  };
}

function SelectField({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: ReminderStatusFilter) => void;
  value: ReminderStatusFilter;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/35"
          value={value}
          onChange={(event) => onChange(event.target.value as ReminderStatusFilter)}
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

function MiniMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'danger' | 'muted' | 'neutral' | 'success' | 'warning' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold',
      tone === 'success' && 'border-success/25 bg-success/10 text-success',
      tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'muted' && 'border-border bg-muted/15 text-muted-foreground',
      tone === 'neutral' && 'border-border bg-background text-muted-foreground',
    )}>
      <span className="uppercase">{label}</span>
      <span className="font-mono text-sm text-current">{value}</span>
    </span>
  );
}

function formatReminderDeviceText(row: ReminderMonitorRow) {
  if (row.activeReminderDevices === 0) return 'No notification device';

  const activeNoun = row.activeReminderDevices === 1 ? 'device' : 'devices';
  if (row.enabledReminderDevices === 0) {
    if (row.reminderType === 'sign_in') return `Sign-in off on ${row.activeReminderDevices} ${activeNoun}`;
    return `Sign-out off on ${row.activeReminderDevices} ${activeNoun}`;
  }

  const enabledNoun = row.enabledReminderDevices === 1 ? 'device' : 'devices';
  if (row.enabledReminderDevices === row.activeReminderDevices) {
    return `${row.enabledReminderDevices} ${enabledNoun} enabled`;
  }

  return `${row.enabledReminderDevices} of ${row.activeReminderDevices} devices enabled`;
}

function ReminderSection({ section }: { section: ReminderMonitorSection }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{section.label}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Scheduled Ghana time: {section.scheduledTime}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MiniMetric label="Sent" value={section.summary.sent} tone="success" />
          <MiniMetric label="Failed" value={section.summary.failed} tone={section.summary.failed ? 'danger' : 'muted'} />
          <MiniMetric label="Missing" value={section.summary.missing} tone={section.summary.missing ? 'danger' : 'muted'} />
          <MiniMetric label="No Trusted" value={section.summary.noTrustedDevice} tone={section.summary.noTrustedDevice ? 'warning' : 'muted'} />
          <MiniMetric label="Not Registered" value={section.summary.notificationsNotRegistered} tone={section.summary.notificationsNotRegistered ? 'warning' : 'muted'} />
          <MiniMetric label="Off" value={section.summary.reminderOff} tone="muted" />
        </div>
      </div>

      {section.alerts.length > 0 && (
        <div className="divide-y divide-border border-b border-border">
          {section.alerts.map((alert) => (
            <div
              key={alert.message}
              className={cn(
                'px-5 py-2.5 text-sm',
                alert.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
              )}
            >
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Devices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                  No reminder rows in this filter.
                </td>
              </tr>
            ) : section.rows.map((row) => (
              <tr key={`${section.reminderType}-${row.staff.id}`} className="transition-colors hover:bg-card/50">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium">{row.staff.fullName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[row.staff.department, row.staff.unit].filter(Boolean).join(' / ') || row.staff.email || '-'}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass(row.status))}>
                    <StatusIcon status={row.status} />
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="max-w-md px-4 py-3 align-top text-muted-foreground">
                  {row.reason}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium">{formatReminderDeviceText(row)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function ReminderDeliveryMonitorPage() {
  const [date, setDate] = useState(getAccraDateKey());
  const [data, setData] = useState<ReminderMonitorResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReminderStatusFilter>('all');

  const loadData = useCallback(async (signal?: AbortSignal, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/attendance/reminder-monitor?date=${encodeURIComponent(date)}`, {
        cache: 'no-store',
        signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load reminder monitor');
      setData(payload);
    } catch (loadError) {
      if ((loadError as Error).name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load reminder monitor');
      setData(null);
    } finally {
      if (!signal?.aborted && !options?.silent) setLoading(false);
    }
  }, [date]);

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

  const dayLabel = useMemo(() => {
    if (!data) return formatDisplayDate(date);
    if (data.day.isHoliday) return `${formatDisplayDate(data.date)} / ${data.day.holidayName || 'Holiday'}`;
    if (data.day.isWeekend) return `${formatDisplayDate(data.date)} / Weekend`;
    return formatDisplayDate(data.date);
  }, [data, date]);

  const totals = useMemo(() => {
    if (!data) {
      return {
        needsReview: 0,
        noTrustedDevice: 0,
        notificationsNotRegistered: 0,
        pending: 0,
        reminderOff: 0,
        sent: 0,
        skipped: 0,
      };
    }
    const sections = [data.sections.signIn, data.sections.signOut];
    return {
      needsReview: sections.reduce((total, section) => total + section.summary.failed + section.summary.missing, 0),
      noTrustedDevice: sections.reduce((total, section) => total + section.summary.noTrustedDevice, 0),
      notificationsNotRegistered: sections.reduce((total, section) => total + section.summary.notificationsNotRegistered, 0),
      pending: sections.reduce((total, section) => total + section.summary.pending + section.summary.waiting, 0),
      reminderOff: sections.reduce((total, section) => total + section.summary.reminderOff, 0),
      sent: sections.reduce((total, section) => total + section.summary.sent, 0),
      skipped: sections.reduce((total, section) => total + section.summary.skipped, 0),
    };
  }, [data]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!data) return null;
    return {
      signIn: filterSection(data.sections.signIn, normalizedQuery, statusFilter),
      signOut: filterSection(data.sections.signOut, normalizedQuery, statusFilter),
    };
  }, [data, normalizedQuery, statusFilter]);

  return (
    <DashboardLayout title="Reminder Monitor">
      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(18rem,1fr)_12rem_12rem_7.5rem] xl:items-end">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label className="block text-xs font-medium uppercase text-muted-foreground">Search</label>
                <span className="truncate text-xs text-muted-foreground">
                  {dayLabel}{data?.generatedAt ? ` / Last updated ${formatDisplayDateTime(data.generatedAt)}` : ''}
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search staff, email, or reason"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <DateField
              ariaLabel="Reminder monitor date"
              label="Date"
              onChange={setDate}
              value={date}
            />
            <SelectField label="Status" value={statusFilter} onChange={setStatusFilter}>
              <option value="all">All statuses</option>
              <option value="sent">Sent</option>
              <option value="needs_review">Needs review</option>
              <option value="no_trusted_device">No trusted device</option>
              <option value="notifications_not_registered">Notifications not registered</option>
              <option value="reminder_off">Reminder off</option>
              <option value="pending">Pending / waiting</option>
              <option value="skipped">Skipped</option>
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

        {loading && !data ? (
          <Card className="flex h-52 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading reminder delivery
            </div>
          </Card>
        ) : data && filteredSections ? (
          <>
            <div className="grid auto-cols-[minmax(8rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-6 xl:overflow-visible xl:pb-0">
              <SummaryFilter active={statusFilter === 'all'} label="Staff" value={data.totalStaff} onClick={() => setStatusFilter('all')} />
              <SummaryFilter active={statusFilter === 'sent'} label="Sent" value={totals.sent} tone="success" onClick={() => setStatusFilter('sent')} />
              <SummaryFilter active={statusFilter === 'needs_review'} label="Needs Review" value={totals.needsReview} tone={totals.needsReview ? 'danger' : 'muted'} onClick={() => setStatusFilter('needs_review')} />
              <SummaryFilter active={statusFilter === 'no_trusted_device'} label="No Trusted" value={totals.noTrustedDevice} tone={totals.noTrustedDevice ? 'warning' : 'muted'} onClick={() => setStatusFilter('no_trusted_device')} />
              <SummaryFilter active={statusFilter === 'notifications_not_registered'} label="Not Registered" value={totals.notificationsNotRegistered} tone={totals.notificationsNotRegistered ? 'warning' : 'muted'} onClick={() => setStatusFilter('notifications_not_registered')} />
              <SummaryFilter active={statusFilter === 'reminder_off'} label="Reminder Off" value={totals.reminderOff} tone="muted" onClick={() => setStatusFilter('reminder_off')} />
            </div>

            <ReminderSection section={filteredSections.signIn} />
            <ReminderSection section={filteredSections.signOut} />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
