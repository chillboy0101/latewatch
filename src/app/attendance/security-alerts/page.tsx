'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCcw, Shield, ShieldAlert } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDisplayDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';

type AlertSeverity = 'critical' | 'high' | 'medium';

interface SecurityAlertRow {
  actorEmail: string;
  createdAt: string;
  entityId: string;
  entityType: string;
  id: string;
  message: string;
  result: string | null;
  severity: AlertSeverity;
  staffId: string | null;
  staffName: string | null;
  title: string;
}

interface SecurityAlertsResponse {
  generatedAt: string;
  rows: SecurityAlertRow[];
  summary: {
    critical: number;
    high: number;
    last24Hours: number;
    total: number;
  };
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'danger' | 'neutral' | 'warning' }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'neutral' && 'border-border bg-card text-foreground',
    )}>
      <p className="text-xs font-medium uppercase text-current/75">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none">{value}</p>
    </div>
  );
}

function severityClass(severity: AlertSeverity) {
  if (severity === 'critical') return 'border-danger/25 bg-danger/10 text-danger';
  if (severity === 'high') return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-border bg-muted/20 text-muted-foreground';
}

export default function SecurityAlertsPage() {
  const [data, setData] = useState<SecurityAlertsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/attendance/security-alerts', {
        cache: 'no-store',
        signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load security alerts');
      setData(payload);
    } catch (loadError) {
      if ((loadError as Error).name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load security alerts');
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
    <DashboardLayout title="Security Alerts">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Admin Security Alerts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Suspicious attendance and device events that were blocked or need review.
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
              Loading security alerts
            </div>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <SummaryMetric label="Total" value={data.summary.total} />
              <SummaryMetric label="Critical" value={data.summary.critical} tone={data.summary.critical ? 'danger' : 'neutral'} />
              <SummaryMetric label="High" value={data.summary.high} tone={data.summary.high ? 'warning' : 'neutral'} />
              <SummaryMetric label="Last 24h" value={data.summary.last24Hours} tone={data.summary.last24Hours ? 'warning' : 'neutral'} />
            </div>

            <Card className="overflow-hidden">
              <div className="border-b border-border p-5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-semibold">Recent Alerts</h2>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Alert</th>
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.rows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                          No security alerts recorded yet.
                        </td>
                      </tr>
                    ) : data.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/15">
                        <td className="max-w-md px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold', severityClass(row.severity))}>
                              {row.severity === 'critical' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                              {row.severity}
                            </span>
                            <span className="font-medium">{row.title}</span>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">{row.message}</div>
                        </td>
                        <td className="px-4 py-3 align-top">{row.staffName || row.staffId || '-'}</td>
                        <td className="px-4 py-3 align-top">
                          <span className="font-mono text-xs">{row.result || '-'}</span>
                        </td>
                        <td className="px-4 py-3 align-top">{row.actorEmail || '-'}</td>
                        <td className="px-4 py-3 align-top">{formatDisplayDateTime(row.createdAt)}</td>
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
