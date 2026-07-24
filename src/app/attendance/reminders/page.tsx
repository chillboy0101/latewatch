'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, RefreshCcw, Search, Smartphone, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
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
type ReminderMonitorType = 'sign_in' | 'sign_out';
type ReminderTypeKey = 'signIn' | 'signOut';

interface ReminderMonitorRow {
  activeReminderDevices: number;
  delivered: boolean;
  delivery: {
    delivered: number;
    disabled: number;
    failed: number;
    latestDeliveredAt: string | null;
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
  lastRunAt: string | null;
  reminderType: string;
  rows: ReminderMonitorRow[];
  scheduledPassed: boolean;
  scheduledTime: string;
  summary: {
    delivered: number;
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

const SECTION_KEY: Record<ReminderMonitorType, ReminderTypeKey> = {
  sign_in: 'signIn',
  sign_out: 'signOut',
};

function statusLabel(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Pending';
  if (status === 'missing') return 'Missing';
  if (status === 'waiting') return 'Waiting';
  if (status === 'no_trusted_device') return 'No trusted device';
  if (status === 'notifications_not_registered') return 'Not registered';
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

function needsAttention(status: ReminderMonitorRowStatus) {
  return status === 'failed'
    || status === 'missing'
    || status === 'no_trusted_device'
    || status === 'notifications_not_registered'
    || status === 'reminder_off';
}

function StatusIcon({ status }: { status: ReminderMonitorRowStatus }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'failed' || status === 'missing') return <XCircle className="h-3.5 w-3.5" />;
  if (status === 'pending' || status === 'waiting') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'no_trusted_device' || status === 'notifications_not_registered' || status === 'reminder_off') return <Smartphone className="h-3.5 w-3.5" />;
  return null;
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

function SummaryStat({ value, label, tone }: { value: number; label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'muted' && 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5',
        active && 'border-primary/60 bg-primary/5 text-foreground',
      )}
    >
      {label}
    </button>
  );
}

export default function ReminderDeliveryMonitorPage() {
  const [date, setDate] = useState(getAccraDateKey());
  const [data, setData] = useState<ReminderMonitorResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ReminderMonitorType>('sign_in');
  const [showAll, setShowAll] = useState(false);

  const loadData = useCallback(async (signal?: AbortSignal, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/attendance/reminder-monitor?date=${encodeURIComponent(date)}`, {
        cache: 'no-store',
        signal,
      });
      const text = await response.text();
      let payload: ReminderMonitorResponse | { error?: string } | null = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(`Failed to load reminder monitor (${response.status})`);
        }
      }
      if (!response.ok || !payload) {
        throw new Error((payload as { error?: string } | null)?.error || `Failed to load reminder monitor (${response.status})`);
      }
      setData(payload as ReminderMonitorResponse);
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

  const dayNote = useMemo(() => {
    if (!data) return null;
    if (data.day.isHoliday) return data.day.holidayName || 'Holiday';
    if (data.day.isWeekend) return 'Weekend';
    return null;
  }, [data]);

  const section = data ? data.sections[SECTION_KEY[activeTab]] : null;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!section) return [];
    return section.rows.filter((row) => rowMatchesQuery(row, normalizedQuery) && (showAll || needsAttention(row.status)));
  }, [section, normalizedQuery, showAll]);

  const attentionCount = section
    ? section.summary.failed + section.summary.missing + section.summary.noTrustedDevice + section.summary.notificationsNotRegistered + section.summary.reminderOff
    : 0;

  return (
    <DashboardLayout title="Reminders">
      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_11rem_7.5rem] xl:items-end">
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search staff"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <div>
              <DateField ariaLabel="Reminder date" label="Date" onChange={setDate} value={date} />
              {dayNote && <p className="mt-1.5 text-xs text-muted-foreground">{dayNote}</p>}
            </div>
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
              Loading reminders
            </div>
          </Card>
        ) : data && section ? (
          <>
            <div className="flex gap-2">
              <TabButton active={activeTab === 'sign_in'} label={data.sections.signIn.label} onClick={() => setActiveTab('sign_in')} />
              <TabButton active={activeTab === 'sign_out'} label={data.sections.signOut.label} onClick={() => setActiveTab('sign_out')} />
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-5 py-4">
                <div className="flex items-center gap-5">
                  <SummaryStat value={section.summary.sent} label="Sent" tone="success" />
                  <SummaryStat value={section.summary.delivered} label="Delivered" tone={section.summary.delivered < section.summary.sent ? 'warning' : 'success'} />
                  <SummaryStat value={attentionCount} label="Need attention" tone={attentionCount > 0 ? 'danger' : 'muted'} />
                </div>
                {section.rows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll((value) => !value)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {showAll ? 'Needing attention only' : `Show all ${section.rows.length}`}
                  </button>
                )}
              </div>

              {section.alerts.length > 0 && (
                <ul className="border-b border-border px-5 py-3">
                  {section.alerts.map((alert) => (
                    <li
                      key={alert.message}
                      className="flex items-start gap-2.5 py-1 text-sm text-muted-foreground"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
                          alert.tone === 'danger' ? 'bg-danger' : 'bg-warning',
                        )}
                      />
                      <span>{alert.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {visibleRows.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {normalizedQuery ? 'No staff match this search.' : 'All staff reminded.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Staff</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleRows.map((row) => (
                        <tr key={`${section.reminderType}-${row.staff.id}`} className="transition-colors hover:bg-card/50">
                          <td className="px-4 py-3 align-top font-medium">{row.staff.fullName}</td>
                          <td className="px-4 py-3 align-top">
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass(row.status))}>
                              <StatusIcon status={row.status} />
                              {statusLabel(row.status)}
                            </span>
                          </td>
                          <td className="max-w-md px-4 py-3 align-top text-muted-foreground">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
