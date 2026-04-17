'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, Plus, Download, Eye, Clock, Users, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { format, startOfWeek, addDays, subWeeks } from 'date-fns';
import { getAblyRealtime } from '@/lib/ably-browser';

interface WeekDayData {
  day: string;
  entries: number;
  amount: number;
  status: 'complete' | 'holiday' | 'empty';
}

interface DashboardStats {
  weekTotal: number;
  weekEntryCount: number;
  staffCount: number;
  prevWeekTotal: number;
  prevWeekEntryCount: number;
  weekDays: WeekDayData[];
  recentEntries: {
    id: string;
    staffName: string;
    date: string;
    arrivalTime: string | null;
    amount: number;
    reason: string;
    createdAt: string | null;
  }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    fetchDashboardData();

    (async () => {
      try {
        const ably = await getAblyRealtime();
        const channel = ably.channels.get('latewatch:dashboard');

        const onInvalidate = () => fetchDashboardData();

        await channel.subscribe('invalidate', onInvalidate);
        setRealtimeConnected(true);

        cleanup = () => {
          channel.unsubscribe('invalidate', onInvalidate);
          setRealtimeConnected(false);
        };
      } catch {
        // Fallback for local/dev or when Ably isn't configured
        const es = new EventSource('/api/realtime/dashboard');

        const handleConnected = () => setRealtimeConnected(true);
        const handleInvalidate = () => fetchDashboardData();
        const handleError = () => setRealtimeConnected(false);

        es.addEventListener('connected', handleConnected);
        es.addEventListener('invalidate', handleInvalidate);
        es.onerror = handleError;

        cleanup = () => {
          es.removeEventListener('connected', handleConnected);
          es.removeEventListener('invalidate', handleInvalidate);
          es.close();
        };
      }
    })();

    return () => {
      cleanup?.();
    };
  }, [fetchDashboardData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  if (loading) {
    return (
      <DashboardLayout title="Dashboard">
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading dashboard...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const weekRange = (() => {
    const today = new Date();
    const start = startOfWeek(today, { weekStartsOn: 1 });
    const end = addDays(start, 4);
    return `${format(start, 'MMM dd')} - ${format(end, 'MMM dd')}`;
  })();

  const penaltyChange = stats && stats.prevWeekTotal > 0
    ? (((stats.weekTotal - stats.prevWeekTotal) / stats.prevWeekTotal) * 100).toFixed(0)
    : null;
  const entryChange = stats && stats.prevWeekEntryCount > 0
    ? (((stats.weekEntryCount - stats.prevWeekEntryCount) / stats.prevWeekEntryCount) * 100).toFixed(0)
    : null;

  return (
    <DashboardLayout title="Dashboard">
      <div className="space-y-6">
        {/* Refresh */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Total Penalties (Week)"
            value={`GHC ${(stats?.weekTotal || 0).toLocaleString()}`}
            change={penaltyChange}
          />
          <StatCard
            title="Entries Recorded"
            value={(stats?.weekEntryCount || 0).toString()}
            change={entryChange}
          />
          <StatCard
            title="Staff Members"
            value={(stats?.staffCount || 0).toString()}
            change={null}
            icon="users"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Quick Actions */}
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/entries">
                <Button className="w-full justify-start gap-2">
                  <Plus className="h-4 w-4" />
                  Enter Today&apos;s Data
                </Button>
              </Link>
              <Link href="/exports">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Download className="h-4 w-4" />
                  Export Weekly
                </Button>
              </Link>
              <Link href="/staff">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Eye className="h-4 w-4" />
                  View Staff
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Week Summary */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Week of {weekRange}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(stats?.weekDays || []).map((day, index) => (
                  <WeekDayRow key={index} {...day} />
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

        {/* Recent Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <Link href="/audit-trail">
              <Button variant="link" size="sm">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {stats?.recentEntries && stats.recentEntries.length > 0 ? (
              <div className="space-y-3">
                {stats.recentEntries.map((entry) => (
                  <ActivityItem
                    key={entry.id}
                    staffName={entry.staffName}
                    date={entry.date}
                    arrivalTime={entry.arrivalTime}
                    amount={entry.amount}
                    reason={entry.reason}
                    time={entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Recently'}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p>No entries yet this week</p>
                <p className="text-sm mt-1">Start by adding staff members and recording daily entries</p>
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
}: {
  title: string;
  value: string;
  change: string | null;
  icon?: 'penalty' | 'entries' | 'users';
}) {
  const icons = {
    penalty: '💰',
    entries: '📊',
    users: '👥',
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-center">
          <div className="mb-2 text-3xl">{icons[icon || 'penalty']}</div>
          <div className="mb-1 text-2xl font-bold font-mono">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
          {change !== null ? (
            <div
              className={`mt-2 text-xs font-medium ${
                Number(change) >= 0 ? 'text-danger' : 'text-success'
              }`}
            >
              <TrendingUp
                className={`inline h-3 w-3 ${
                  Number(change) < 0 ? 'rotate-180' : ''
                }`}
              />{' '}
              {Number(change) >= 0 ? '+' : ''}{change}% vs last week
            </div>
          ) : (
            <div className="mt-2 text-xs font-medium text-muted-foreground">
              Active staff
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekDayRow({ day, entries, amount, status }: WeekDayData) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{day}</span>
      <span className={
        status === 'complete' ? 'text-success' :
        status === 'holiday' ? 'text-muted' :
        'text-warning'
      }>
        {status === 'complete' ? `${entries} entries` :
         status === 'holiday' ? 'Holiday' :
         'No entries'}
      </span>
      <span className="font-mono">{amount > 0 ? `GHC ${amount}` : '—'}</span>
    </div>
  );
}

function ActivityItem({ staffName, date, arrivalTime, amount, reason, time }: {
  staffName: string; date: string; arrivalTime: string | null; amount: number; reason: string; time: string;
}) {
  const isLate = amount > 0;
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1 h-2 w-2 rounded-full ${isLate ? 'bg-danger' : 'bg-success'}`} />
      <div className="flex-1">
        <p className="text-sm">
          <span className="font-medium">{staffName}</span>
          {' — '}
          <span className={isLate ? 'text-danger' : 'text-success'}>
            {isLate ? 'Late' : 'On time'}
          </span>
          {arrivalTime && <span className="text-muted-foreground"> at {arrivalTime}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {date} {reason && `— ${reason}`} {amount > 0 && `(GHC ${amount})`}
        </p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{time}</span>
    </div>
  );
}