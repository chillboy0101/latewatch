'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Clock3, Loader2, RefreshCcw, Smartphone, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { cn } from '@/lib/utils';

type ReminderMonitorRowStatus = 'sent' | 'failed' | 'pending' | 'missing' | 'waiting' | 'skipped' | 'no_device';
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
  label: string;
  reminderType: string;
  rows: ReminderMonitorRow[];
  scheduledTime: string;
  summary: {
    eligible: number;
    failed: number;
    missing: number;
    noDevice: number;
    pending: number;
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
  if (status === 'no_device') return 'No device';
  return 'Skipped';
}

function statusClass(status: ReminderMonitorRowStatus) {
  if (status === 'sent') return 'border-success/25 bg-success/10 text-success';
  if (status === 'failed' || status === 'missing') return 'border-danger/25 bg-danger/10 text-danger';
  if (status === 'pending' || status === 'waiting') return 'border-warning/25 bg-warning/10 text-warning';
  if (status === 'no_device') return 'border-border bg-muted/20 text-muted-foreground';
  return 'border-border bg-card text-muted-foreground';
}

function StatusIcon({ status }: { status: ReminderMonitorRowStatus }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'failed' || status === 'missing') return <XCircle className="h-3.5 w-3.5" />;
  if (status === 'pending' || status === 'waiting') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'no_device') return <Smartphone className="h-3.5 w-3.5" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'danger' | 'muted' | 'neutral' | 'success' | 'warning' }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      tone === 'success' && 'border-success/25 bg-success/10 text-success',
      tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'muted' && 'border-border bg-muted/15 text-muted-foreground',
      tone === 'neutral' && 'border-border bg-background text-foreground',
    )}>
      <p className="text-xs font-medium uppercase text-current/75">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none">{value}</p>
    </div>
  );
}

function ReminderSection({ section }: { section: ReminderMonitorSection }) {
  const problemCount = section.summary.failed + section.summary.missing;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border p-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">{section.label}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Scheduled Ghana time: {section.scheduledTime}</p>
        </div>
        <div className="grid grid-cols-4 gap-2 xl:w-[34rem]">
          <SummaryMetric label="Sent" value={section.summary.sent} tone="success" />
          <SummaryMetric label="Failed" value={section.summary.failed} tone={section.summary.failed ? 'danger' : 'muted'} />
          <SummaryMetric label="Missing" value={section.summary.missing} tone={section.summary.missing ? 'danger' : 'muted'} />
          <SummaryMetric label="No Device" value={section.summary.noDevice} tone={section.summary.noDevice ? 'warning' : 'muted'} />
        </div>
      </div>

      {problemCount > 0 && (
        <div className="border-b border-danger/25 bg-danger/10 px-5 py-3 text-sm text-danger">
          {problemCount} eligible staff need attention for this reminder window.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Devices</th>
              <th className="px-4 py-3 font-medium">Delivery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.rows.map((row) => (
              <tr key={`${section.reminderType}-${row.staff.id}`} className="hover:bg-muted/15">
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
                  <div className="font-medium">{row.enabledReminderDevices} enabled</div>
                  <div className="mt-1 text-xs text-muted-foreground">{row.activeReminderDevices} active subscription{row.activeReminderDevices === 1 ? '' : 's'}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium">
                    {row.delivery.sent} sent / {row.delivery.failed + row.delivery.disabled} failed
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.delivery.latestSentAt ? formatDisplayDateTime(row.delivery.latestSentAt) : row.delivery.pending ? `${row.delivery.pending} pending` : '-'}
                  </div>
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

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
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
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData, refreshKey]);

  const dayLabel = useMemo(() => {
    if (!data) return formatDisplayDate(date);
    if (data.day.isHoliday) return `${formatDisplayDate(data.date)} / ${data.day.holidayName || 'Holiday'}`;
    if (data.day.isWeekend) return `${formatDisplayDate(data.date)} / Weekend`;
    return formatDisplayDate(data.date);
  }, [data, date]);

  return (
    <DashboardLayout title="Reminder Monitor">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Reminder Delivery Monitor</h1>
            <p className="mt-1 text-sm text-muted-foreground">{dayLabel}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <DateField
              ariaLabel="Reminder monitor date"
              className="w-44"
              label="Date"
              onChange={setDate}
              value={date}
            />
            <Button
              className="h-10 gap-2"
              variant="outline"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
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
              Loading reminder delivery
            </div>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <SummaryMetric label="Staff" value={data.totalStaff} />
              <SummaryMetric label="8:15 Sent" value={data.sections.signIn.summary.sent} tone="success" />
              <SummaryMetric label="4:30 Sent" value={data.sections.signOut.summary.sent} tone="success" />
              <SummaryMetric
                label="Needs Review"
                value={
                  data.sections.signIn.summary.failed
                  + data.sections.signIn.summary.missing
                  + data.sections.signOut.summary.failed
                  + data.sections.signOut.summary.missing
                }
                tone={
                  data.sections.signIn.summary.failed
                  + data.sections.signIn.summary.missing
                  + data.sections.signOut.summary.failed
                  + data.sections.signOut.summary.missing
                    ? 'danger'
                    : 'muted'
                }
              />
            </div>

            <ReminderSection section={data.sections.signIn} />
            <ReminderSection section={data.sections.signOut} />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
