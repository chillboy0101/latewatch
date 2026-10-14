'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  ClipboardList,
  DollarSign,
  Download,
  Eye,
  Plus,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { formatDisplayDateTime, formatShortDisplayDate } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';

interface WeekDayData {
  day: string;
  entries: number;
  amount: number;
  status: 'penalties' | 'clear' | 'today' | 'upcoming' | 'holiday';
}

interface DashboardStats {
  missedReminders?: { label: string; reminderType: string; sentByApp: boolean }[];
  weekTotal: number;
  weekEntryCount: number;
  staffCount: number;
  prevWeekTotal: number;
  prevWeekEntryCount: number;
  weekDays: WeekDayData[];
  weekEnd?: string;
  weekStart?: string;
  recentActivity: {
    actionLabel: string;
    actorEmail: string;
    entityId: string;
    entityLabel: string;
    entityType: string;
    id: string;
    summary: string;
    timestamp: string | null;
  }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Dashboard request failed (${res.status})`);
      setStats(data);
      setLoadError(null);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    fetchDashboardData();

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'dashboard',
        events: ['invalidate'],
        onEvent: fetchDashboardData,
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
  }, [fetchDashboardData]);

  if (loading) {
    return (
      <DashboardLayout title="Dashboard">
        <LoadingBuffer
          variant="page"
          label="Loading dashboard"
          description="Preparing weekly metrics and recent activity."
        />
      </DashboardLayout>
    );
  }

  if (!stats) {
    return (
      <DashboardLayout title="Dashboard">
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-5 text-danger sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Dashboard data could not be loaded</p>
              <p className="mt-1 text-sm">{loadError || 'Please try again.'}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void fetchDashboardData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // The server works the week out in Accra time, so the label matches the rows whatever the laptop's time zone.
  const weekRange = stats?.weekStart && stats.weekEnd
    ? `${formatShortDisplayDate(stats.weekStart)} - ${formatShortDisplayDate(stats.weekEnd)}`
    : '';

  const penaltyChange = stats && stats.prevWeekTotal > 0
    ? (((stats.weekTotal - stats.prevWeekTotal) / stats.prevWeekTotal) * 100).toFixed(0)
    : null;
  const entryChange = stats && stats.prevWeekEntryCount > 0
    ? (((stats.weekEntryCount - stats.prevWeekEntryCount) / stats.prevWeekEntryCount) * 100).toFixed(0)
    : null;
  const recentActivity = stats?.recentActivity.slice(0, 10) || [];

  return (
    <DashboardLayout title="Dashboard">
      <div className="space-y-6">
        {(stats.missedReminders || []).map((missed) => (
          <Link
            key={missed.reminderType}
            href="/attendance/devices"
            role="alert"
            className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger transition-colors hover:bg-danger/15"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">The {missed.label} reminder job didn&apos;t run today.</span>{' '}
              {missed.sentByApp ? 'LateWatch sent the reminders from the app instead.' : 'LateWatch will send them on the next page visit.'}{' '}
              Check the cron jobs.
            </span>
          </Link>
        ))}
        {loadError && (
          <div role="alert" className="flex items-center gap-3 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Could not refresh dashboard data. Showing the last successful results.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Weekly Penalties"
            value={`GHC ${(stats?.weekTotal || 0).toLocaleString()}`}
            change={penaltyChange}
            icon="penalty"
            fallback={null}
          />
          <StatCard
            title="Entries"
            value={(stats?.weekEntryCount || 0).toString()}
            change={entryChange}
            icon="entries"
            fallback="This week"
          />
          <StatCard
            title="Active Staff"
            value={(stats?.staffCount || 0).toString()}
            change={null}
            icon="users"
            fallback={null}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/entries">
                <Button className="w-full justify-start gap-2">
                  <Plus className="h-4 w-4" />
                  Record Entries
                </Button>
              </Link>
              <Link href="/exports">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Download className="h-4 w-4" />
                  Export This Week
                </Button>
              </Link>
              <Link href="/staff">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Eye className="h-4 w-4" />
                  Manage Staff
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Week of {weekRange}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(stats?.weekDays || []).map((day) => (
                  <WeekDayRow key={day.day} {...day} />
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex justify-between text-sm font-medium">
                  <span>Week Total:</span>
                  <span className="font-mono">GHC {(stats?.weekTotal || 0).toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <Link href="/audit-trail">
              <Button variant="link" size="sm">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <ActivityItem
                    key={activity.id}
                    summary={activity.summary}
                    time={activity.timestamp ? formatDisplayDateTime(activity.timestamp) : 'Recently'}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p>No recent system activity yet</p>
                <p className="text-sm mt-1">Staff, entries, exports, notifications, and calendar changes will appear here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  title,
  value,
  change,
  icon,
  fallback,
}: {
  title: string;
  value: string;
  change: string | null;
  icon?: 'penalty' | 'entries' | 'users';
  fallback: string | null;
}) {
  const Icon = icon === 'users' ? Users : icon === 'entries' ? ClipboardList : DollarSign;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="mb-1 text-2xl font-bold font-mono">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
          {change !== null ? (
            <div className={`mt-2 text-xs font-medium ${Number(change) >= 0 ? 'text-danger' : 'text-success'}`}>
              <TrendingUp className={`inline h-3 w-3 ${Number(change) < 0 ? 'rotate-180' : ''}`} />{' '}
              {Number(change) >= 0 ? '+' : ''}{change}% vs last week
            </div>
          ) : fallback ? (
            <div className="mt-2 text-xs font-medium text-muted-foreground">{fallback}</div>
          ) : (
            <div className="mt-2 h-4" aria-hidden="true" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekDayRow({ day, entries, amount, status }: WeekDayData) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{day}</span>
      <span className={
        status === 'penalties' ? 'text-warning' :
        status === 'clear' ? 'text-success' :
        'text-muted-foreground'
      }>
        {status === 'penalties' ? `${entries} ${entries === 1 ? 'penalty' : 'penalties'}` :
         status === 'holiday' ? 'Holiday' :
         status === 'upcoming' ? 'Upcoming' :
         status === 'today' ? 'None yet' :
         'No penalties'}
      </span>
      <span className="font-mono">{amount > 0 ? `GHC ${amount}` : '-'}</span>
    </div>
  );
}

function ActivityItem({
  summary,
  time,
}: {
  summary: string;
  time: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-1.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary">
        <Activity className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-5">
          {summary}
        </p>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{time}</span>
    </div>
  );
}
