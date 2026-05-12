'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { getMonthWorkingWeeks, type WorkingWeekRange } from '@/lib/export-weeks';

interface WeekSummary extends WorkingWeekRange {
  weekLabel: string;
  totalLateArrivals: number;
  totalSignOut: number;
  totalAmount: number;
}

interface ExportEntry {
  date: string;
  didNotSignOut: boolean | null;
  computedAmount: string | number | null;
  reason: string | null;
}

type ExportTarget = { type: 'monthly' } | { type: 'weekly'; key: string } | null;

function normalizeDateKey(value: string) {
  return value.includes('T') ? value.slice(0, 10) : value;
}

function countLateArrivals(entries: ExportEntry[]) {
  return entries.length;
}

function countSignOutEntries(entries: ExportEntry[]) {
  return entries.filter((entry) => entry.didNotSignOut).length;
}

function sumAmounts(entries: ExportEntry[]) {
  return entries.reduce((sum, entry) => sum + parseFloat(String(entry.computedAmount || '0')), 0);
}

function exportKeyForWeek(week: WorkingWeekRange) {
  return `weekly-${week.weekNumber}-${week.exportStart}-${week.exportEnd}`;
}

async function downloadWorkbook(response: Response, fileName: string) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export default function ExportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportTarget>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedYear = selectedMonth.getFullYear();
  const selectedMonthIndex = selectedMonth.getMonth();
  const isMonthlyExporting = exporting?.type === 'monthly';

  const fetchExportData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const monthStart = startOfMonth(selectedMonth);
      const monthEnd = endOfMonth(selectedMonth);
      const startStr = format(monthStart, 'yyyy-MM-dd');
      const endStr = format(monthEnd, 'yyyy-MM-dd');

      const response = await fetch(`/api/entries?start=${startStr}&end=${endStr}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load entries (${response.status})`);

      const allEntries = await response.json();
      const entriesList = Array.isArray(allEntries) ? allEntries as ExportEntry[] : [];

      const entriesByDate = new Map<string, ExportEntry[]>();
      for (const entry of entriesList) {
        const dateKey = normalizeDateKey(entry.date);
        const entries = entriesByDate.get(dateKey) || [];
        entries.push(entry);
        entriesByDate.set(dateKey, entries);
      }

      const summaries = getMonthWorkingWeeks(selectedYear, selectedMonthIndex).map((week) => {
        const weekEntries = week.dates.flatMap((dateKey) => entriesByDate.get(dateKey) || []);

        return {
          ...week,
          weekLabel: `Week ${week.weekNumber}`,
          totalLateArrivals: countLateArrivals(weekEntries),
          totalSignOut: countSignOutEntries(weekEntries),
          totalAmount: sumAmounts(weekEntries),
        };
      });

      setWeekSummaries(summaries);
    } catch (err) {
      console.error('Failed to fetch export data:', err);
      setWeekSummaries([]);
      setError(err instanceof Error ? err.message : 'Could not load export data');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedMonthIndex, selectedYear]);

  useEffect(() => {
    fetchExportData();
  }, [fetchExportData]);

  const monthlyTotals = useMemo(
    () => weekSummaries.reduce(
      (totals, week) => ({
        lateArrivals: totals.lateArrivals + week.totalLateArrivals,
        signOut: totals.signOut + week.totalSignOut,
        amount: totals.amount + week.totalAmount,
      }),
      { lateArrivals: 0, signOut: 0, amount: 0 },
    ),
    [weekSummaries],
  );

  async function handleWeeklyExport(week: WeekSummary) {
    if (exporting) return;

    const exportKey = exportKeyForWeek(week);
    setExporting({ type: 'weekly', key: exportKey });
    setError(null);

    try {
      const response = await fetch('/api/export/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: week.exportStart,
          weekEnd: week.exportEnd,
          weekNumber: week.weekNumber,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed (${response.status})`);
      }

      await downloadWorkbook(
        response,
        `Lateness_${format(selectedMonth, 'yyyy-MM')}_Week_${week.weekNumber}_${week.exportStart}_${week.exportEnd}.xlsx`,
      );
    } catch (err) {
      console.error('Weekly export failed:', err);
      setError(err instanceof Error ? err.message : 'Weekly export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleMonthlyExport() {
    if (exporting) return;

    setExporting({ type: 'monthly' });
    setError(null);

    try {
      const response = await fetch('/api/export/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonthIndex,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Monthly export failed (${response.status})`);
      }

      await downloadWorkbook(response, `Lateness_${format(selectedMonth, 'MMMM_yyyy')}.xlsx`);
    } catch (err) {
      console.error('Monthly export failed:', err);
      setError(err instanceof Error ? err.message : 'Monthly export failed');
    } finally {
      setExporting(null);
    }
  }

  return (
    <DashboardLayout title="Lateness Exports">
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold leading-none">Lateness Exports</h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="w-full sm:w-44">
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Month</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedMonthIndex}
                      onChange={(event) => setSelectedMonth(new Date(selectedYear, parseInt(event.target.value, 10), 1))}
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index} value={index}>
                          {format(new Date(selectedYear, index, 1), 'MMMM')}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <div className="w-full sm:w-28">
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Year</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedYear}
                      onChange={(event) => setSelectedMonth(new Date(parseInt(event.target.value, 10), selectedMonthIndex, 1))}
                    >
                      {Array.from({ length: 11 }, (_, index) => {
                        const year = 2024 + index;
                        return (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <Button
                  className="h-10 gap-2 sm:mt-[1.625rem]"
                  onClick={handleMonthlyExport}
                  disabled={loading || weekSummaries.length === 0 || (exporting !== null && !isMonthlyExporting)}
                  aria-busy={isMonthlyExporting}
                >
                  {isMonthlyExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {isMonthlyExporting ? 'Downloading Month' : 'Monthly Workbook'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-px border-b border-border bg-border sm:grid-cols-3">
            <SummaryCell label="Late arrivals" value={monthlyTotals.lateArrivals.toString()} tone="danger" />
            <SummaryCell label="No sign out" value={monthlyTotals.signOut.toString()} tone="warning" />
            <SummaryCell label="Amount" value={`GHC ${monthlyTotals.amount.toFixed(2)}`} mono />
          </div>

          <div className="p-4">
            {loading ? (
              <LoadingBuffer
                variant="section"
                label="Loading export weeks"
                description="Calculating working-day ranges and monthly totals."
              />
            ) : (
              <div className="space-y-2">
                {weekSummaries.map((week) => {
                  const weekExportKey = exportKeyForWeek(week);
                  const isExporting = exporting?.type === 'weekly' && exporting.key === weekExportKey;
                  const isOtherExporting = exporting !== null && !isExporting;

                  return (
                    <div
                      key={week.weekStart}
                      className="grid gap-3 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:bg-card lg:grid-cols-[minmax(180px,1.2fr)_repeat(3,minmax(112px,0.6fr))_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{week.weekLabel}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {format(parseISO(week.exportStart), 'MMM d')} - {format(parseISO(week.exportEnd), 'MMM d')}
                          {' '}({week.dates.length} working day{week.dates.length === 1 ? '' : 's'})
                        </p>
                      </div>

                      <Metric label="Late arrivals" value={week.totalLateArrivals.toString()} tone="danger" />
                      <Metric label="No sign out" value={week.totalSignOut.toString()} tone="warning" />
                      <Metric label="Amount" value={`GHC ${week.totalAmount.toFixed(2)}`} mono />

                      <div className="flex flex-wrap gap-2 lg:justify-self-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => handleWeeklyExport(week)}
                          disabled={isOtherExporting || isExporting}
                          aria-busy={isExporting}
                        >
                          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          {isExporting ? 'Downloading' : 'Download'}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {error && (
                  <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SummaryCell({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
  mono?: boolean;
}) {
  return (
    <div className="bg-card px-5 py-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${mono ? 'font-mono' : ''} ${
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''
      }`}>
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-semibold ${mono ? 'font-mono' : ''} ${
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''
      }`}>
        {value}
      </p>
    </div>
  );
}
