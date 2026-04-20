'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Loader2, FileSpreadsheet } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addDays, addMonths, parseISO } from 'date-fns';

interface DayData {
  day: string;
  date: string;
  entries: number;
  late: number;
  signOut: number;
  amount: number;
}

interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  days: DayData[];
  totalEntries: number;
  totalLate: number;
  totalSignOut: number;
  totalAmount: number;
}

export default function ExportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0);
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'weekly' | 'monthly' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchExportData = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = startOfMonth(selectedMonth);
      const monthEnd = endOfMonth(selectedMonth);
      const startStr = format(monthStart, 'yyyy-MM-dd');
      const endStr = format(monthEnd, 'yyyy-MM-dd');

      // Single batch fetch for the entire month
      const response = await fetch(`/api/entries?start=${startStr}&end=${endStr}`);
      const allEntries = await response.json();
      const entriesList = Array.isArray(allEntries) ? allEntries : [];

      // Group entries by date
      const entriesByDate: Record<string, any[]> = {};
      for (const entry of entriesList) {
        if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
        entriesByDate[entry.date].push(entry);
      }

      // Build week summaries
      const summaries: WeekSummary[] = [];
      let monthTotal = 0;
      let weekIdx = 0;
      let weekStart = new Date(monthStart);

      while (weekStart <= monthEnd) {
        const startDayOfWeek = weekStart.getDay();
        let daysToFriday: number;

        if (weekIdx === 0) {
          daysToFriday = startDayOfWeek <= 5 ? 5 - startDayOfWeek : 0;
        } else {
          daysToFriday = 4;
        }

        const weekEnd = addDays(weekStart, daysToFriday);
        if (weekStart > monthEnd) break;

        const days: DayData[] = [];
        let weekEntries = 0, weekLate = 0, weekSignOut = 0, weekAmount = 0;

        for (let d = new Date(weekStart); d <= weekEnd; d = addDays(d, 1)) {
          if (d < monthStart || d > monthEnd) continue;
          const dow = d.getDay();
          if (dow === 0 || dow === 6) continue;

          const dateStr = format(d, 'yyyy-MM-dd');
          const dayName = format(d, 'EEE dd');
          const dayEntries = entriesByDate[dateStr] || [];

          const lateCount = dayEntries.filter((e: any) => parseFloat(e.computedAmount || '0') > 0 && !e.reason?.includes('SIGN OUT')).length;
          const signOutCount = dayEntries.filter((e: any) => e.didNotSignOut).length;
          const dayAmount = dayEntries.reduce((sum: number, e: any) => sum + parseFloat(e.computedAmount || '0'), 0);

          days.push({
            day: dayName,
            date: dateStr,
            entries: dayEntries.length,
            late: lateCount,
            signOut: signOutCount,
            amount: dayAmount,
          });

          weekEntries += dayEntries.length;
          weekLate += lateCount;
          weekSignOut += signOutCount;
          weekAmount += dayAmount;
          monthTotal += dayAmount;
        }

        if (days.length > 0) {
          const actualStart = days[0]?.date || format(weekStart, 'yyyy-MM-dd');
          const actualEnd = days[days.length - 1]?.date || format(weekEnd, 'yyyy-MM-dd');

          summaries.push({
            weekStart: actualStart,
            weekEnd: actualEnd,
            weekLabel: `Week ${weekIdx + 1} (${format(parseISO(actualStart), 'MMM dd')} - ${format(parseISO(actualEnd), 'MMM dd')})`,
            days,
            totalEntries: weekEntries,
            totalLate: weekLate,
            totalSignOut: weekSignOut,
            totalAmount: weekAmount,
          });
          weekIdx++;
        }

        const nextMonday = addDays(weekEnd, 3);
        weekStart = nextMonday;
      }

      setWeekSummaries(summaries);
      setMonthlyTotal(monthTotal);
      setSelectedWeekIdx(0);
    } catch (error) {
      console.error('Failed to fetch export data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchExportData();
  }, [fetchExportData]);

  async function handleWeeklyExport() {
    setExporting('weekly');
    setError(null);
    try {
      const week = weekSummaries[selectedWeekIdx];
      if (!week) return;

      const response = await fetch('/api/export/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Lateness_${week.weekStart}_${week.weekEnd}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleMonthlyExport() {
    setExporting('monthly');
    setError(null);
    try {
      const year = selectedMonth.getFullYear();
      const month = selectedMonth.getMonth();

      const response = await fetch('/api/export/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Lateness_Monthly_${year}_${month + 1}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  const currentWeek = weekSummaries[selectedWeekIdx];

  return (
    <DashboardLayout title="Export Center">
      <div className="space-y-6">
        {/* Weekly Export */}
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Weekly Export</h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading data...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Month/Year Selector */}
                <div className="flex gap-2 items-end">
                  <div className="w-48">
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">Month</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={selectedMonth.getMonth()}
                      onChange={(e) => setSelectedMonth(new Date(selectedMonth.getFullYear(), parseInt(e.target.value), 1))}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={i}>{format(new Date(2026, i, 1), 'MMMM')}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">Year</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={selectedMonth.getFullYear()}
                      onChange={(e) => setSelectedMonth(new Date(parseInt(e.target.value), selectedMonth.getMonth(), 1))}
                    >
                      {Array.from({ length: 11 }, (_, i) => {
                        const year = 2024 + i;
                        return <option key={year} value={year}>{year}</option>;
                      })}
                    </select>
                  </div>
                </div>

                {/* Week Selector */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Select Week</label>
                  <div className="flex gap-2 flex-wrap">
                    {weekSummaries.map((week, idx) => (
                      <Button
                        key={idx}
                        variant={idx === selectedWeekIdx ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedWeekIdx(idx)}
                      >
                        {week.weekLabel}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Week details */}
                {currentWeek && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Entries:</span>{' '}
                        <span className="font-medium">{currentWeek.totalEntries}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Late:</span>{' '}
                        <span className="font-medium text-danger">{currentWeek.totalLate}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">No Sign Out:</span>{' '}
                        <span className="font-medium text-warning">{currentWeek.totalSignOut}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total:</span>{' '}
                        <span className="font-mono font-semibold">GHC {currentWeek.totalAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <Button className="w-full gap-2" onClick={handleWeeklyExport} disabled={exporting === 'weekly'}>
                  {exporting === 'weekly' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {exporting === 'weekly' ? 'Generating...' : 'Download Weekly Excel'}
                </Button>
                {error && (
                  <p className="text-sm text-danger text-center">{error}</p>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Monthly Export */}
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Monthly Export</h2>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="w-48">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Month</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={selectedMonth.getMonth()}
                    onChange={(e) => setSelectedMonth(new Date(selectedMonth.getFullYear(), parseInt(e.target.value), 1))}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i}>{format(new Date(2026, i, 1), 'MMMM')}</option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Year</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={selectedMonth.getFullYear()}
                    onChange={(e) => setSelectedMonth(new Date(parseInt(e.target.value), selectedMonth.getMonth(), 1))}
                  >
                    {Array.from({ length: 11 }, (_, i) => {
                      const year = 2024 + i;
                      return <option key={year} value={year}>{year}</option>;
                    })}
                  </select>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                Weeks included: {weekSummaries.map((_, idx) => `Week ${idx + 1}`).join(', ')}
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Month Total:</span>
                  <span className="font-mono font-semibold">GHC {monthlyTotal.toFixed(2)}</span>
                </div>
              </div>

              <Button className="w-full gap-2" onClick={handleMonthlyExport} disabled={exporting === 'monthly'}>
                {exporting === 'monthly' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting === 'monthly' ? 'Generating...' : 'Download Monthly Excel'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}