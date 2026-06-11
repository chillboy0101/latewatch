'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2, RefreshCcw, Search, Shield } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDisplayDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';

type AlertSeverity = 'critical' | 'high' | 'medium';
type SeverityFilter = 'all' | AlertSeverity;
type AlertTypeFilter = 'all' | 'shared_device' | 'untrusted_device' | 'transfer_session' | 'location' | 'other';

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

function alertTypeFor(row: SecurityAlertRow): AlertTypeFilter {
  if (row.result === 'SHARED_ATTENDANCE_DEVICE') return 'shared_device';
  if (row.result === 'REGISTERED_DEVICE_REQUIRED') return 'untrusted_device';
  if (row.result?.startsWith('TRANSFER_SESSION')) return 'transfer_session';
  if (row.result?.includes('LOCATION') || row.result?.includes('OFFICE')) return 'location';
  return 'other';
}

function alertMatchesQuery(row: SecurityAlertRow, query: string) {
  if (!query) return true;

  return [
    row.title,
    row.message,
    row.staffName || '',
    row.staffId || '',
    row.actorEmail,
    row.result || '',
    row.entityType,
  ].join(' ').toLowerCase().includes(query);
}

function alertMatchesFilters(row: SecurityAlertRow, severityFilter: SeverityFilter, typeFilter: AlertTypeFilter) {
  return (severityFilter === 'all' || row.severity === severityFilter)
    && (typeFilter === 'all' || alertTypeFor(row) === typeFilter);
}

function severityClass(severity: AlertSeverity) {
  if (severity === 'critical') return 'border-danger/25 bg-danger/10 text-danger';
  if (severity === 'high') return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-border bg-muted/20 text-muted-foreground';
}

function SelectField<TValue extends string>({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: TValue) => void;
  value: TValue;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/35"
          value={value}
          onChange={(event) => onChange(event.target.value as TValue)}
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
  tone?: 'danger' | 'muted' | 'neutral' | 'warning';
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

export default function SecurityAlertsPage() {
  const [data, setData] = useState<SecurityAlertsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>('all');

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

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (data?.rows || [])
      .filter((row) => alertMatchesQuery(row, query) && alertMatchesFilters(row, severityFilter, typeFilter));
  }, [data?.rows, searchQuery, severityFilter, typeFilter]);

  const typeCounts = useMemo(() => {
    const rows = data?.rows || [];
    return {
      sharedDevice: rows.filter((row) => alertTypeFor(row) === 'shared_device').length,
      untrustedDevice: rows.filter((row) => alertTypeFor(row) === 'untrusted_device').length,
    };
  }, [data?.rows]);

  return (
    <DashboardLayout title="Security Alerts">
      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(18rem,1fr)_12rem_13rem_7.5rem] xl:items-end">
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search staff, actor, result, or message"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <SelectField<SeverityFilter> label="Severity" value={severityFilter} onChange={setSeverityFilter}>
              <option value="all">All severity</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
            </SelectField>
            <SelectField<AlertTypeFilter> label="Type" value={typeFilter} onChange={setTypeFilter}>
              <option value="all">All alerts</option>
              <option value="shared_device">Shared device</option>
              <option value="untrusted_device">Untrusted device</option>
              <option value="transfer_session">Transfer session</option>
              <option value="location">Location / office</option>
              <option value="other">Other</option>
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
              Loading security alerts
            </div>
          </Card>
        ) : data ? (
          <>
            <div className="grid auto-cols-[minmax(8rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-5 xl:overflow-visible xl:pb-0">
              <SummaryFilter active={severityFilter === 'all' && typeFilter === 'all'} label="Total" value={data.summary.total} onClick={() => { setSeverityFilter('all'); setTypeFilter('all'); }} />
              <SummaryFilter active={severityFilter === 'critical'} label="Critical" value={data.summary.critical} tone={data.summary.critical ? 'danger' : 'muted'} onClick={() => { setSeverityFilter('critical'); setTypeFilter('all'); }} />
              <SummaryFilter active={severityFilter === 'high'} label="High" value={data.summary.high} tone={data.summary.high ? 'warning' : 'muted'} onClick={() => { setSeverityFilter('high'); setTypeFilter('all'); }} />
              <SummaryFilter active={typeFilter === 'shared_device'} label="Shared Device" value={typeCounts.sharedDevice} tone={typeCounts.sharedDevice ? 'danger' : 'muted'} onClick={() => { setSeverityFilter('all'); setTypeFilter('shared_device'); }} />
              <SummaryFilter active={typeFilter === 'untrusted_device'} label="Untrusted" value={typeCounts.untrustedDevice} tone={typeCounts.untrustedDevice ? 'warning' : 'muted'} onClick={() => { setSeverityFilter('all'); setTypeFilter('untrusted_device'); }} />
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Alert</th>
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                          No security alerts in this filter.
                        </td>
                      </tr>
                    ) : filteredRows.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-card/50">
                        <td className="max-w-md px-4 py-3 align-top">
                          <div className="flex flex-wrap items-center gap-2">
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
