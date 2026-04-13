// app/exports/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Upload, Loader2 } from 'lucide-react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, parseISO, addMonths } from 'date-fns';

// Generate month options for dropdown (past 12 months + next 12 months)
function generateMonthOptions() {
  const now = new Date();
  const options = [];
  for (let i = -12; i <= 12; i++) {
    const month = addMonths(now, i);
    const value = format(month, 'yyyy-MM');
    const label = format(month, 'MMMM yyyy');
    options.push(
      <option key={value} value={value}>
        {label}
      </option>
    );
  }
  return options;
}

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

  useEffect(() => {
    fetchExportData();
  }, [selectedMonth]);

  async function fetchExportData() {
    setLoading(true);
    try {
      const monthStart = startOfMonth(selectedMonth);
      const monthEnd = endOfMonth(selectedMonth);
      
      const summaries: WeekSummary[] = [];
      let monthTotal = 0;
      let weekIdx = 0;
      
      // Start from the 1st of the month
      let weekStart = new Date(monthStart);
      
      while (weekStart <= monthEnd) {
        // Calculate the Friday of this week
        const startDayOfWeek = weekStart.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
        let daysToFriday: number;
        
        if (weekIdx === 0) {
          // First week: find Friday of this week
          daysToFriday = startDayOfWeek <= 5 ? 5 - startDayOfWeek : 0;
        } else {
          // Subsequent weeks always start on Monday, so Friday is 4 days later
          daysToFriday = 4;
        }
        
        const weekEnd = addDays(weekStart, daysToFriday);
        
        // Skip if this week is entirely after the month
        if (weekStart > monthEnd) break;

        const days: DayData[] = [];
        let weekEntries = 0, weekLate = 0, weekSignOut = 0, weekAmount = 0;

        // Iterate through each day of this week (Mon-Fri range)
        for (let d = new Date(weekStart); d <= weekEnd; d = addDays(d, 1)) {
          // Only include days within this month and Mon-Fri
          if (d < monthStart || d > monthEnd) continue;
          const dow = d.getDay();
          if (dow === 0 || dow === 6) continue; // Skip weekends

          const dateStr = format(d, 'yyyy-MM-dd');
          const dayName = format(d, 'EEE dd');
          
          // Fetch entries for this day
          try {
            const response = await fetch(`/api/entries?date=${dateStr}`);
            const entries = await response.json();
            const dayEntries = Array.isArray(entries) ? entries : [];
            
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
          } catch (err) {
            console.error(`Failed to fetch entries for ${dateStr}:`, err);
          }
        }

        // Only add week if it has days in this month
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

        // Move to next week's Monday
        const nextMonday = addDays(weekEnd, 3); // Saturday + 2 = Monday
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
  }

  async function handleWeeklyExport() {
    setExporting('weekly');
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

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lateness_${week.weekStart}_${week.weekEnd}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(null);
    }
  }

  async function handleMonthlyExport() {
    setExporting('monthly');
    try {
      const year = selectedMonth.getFullYear();
      const month = selectedMonth.getMonth();

      const response = await fetch('/api/export/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lateness_Monthly_${year}_${month + 1}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
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
            <h2 className="mb-4 text-center text-lg font-semibold">WEEKLY EXPORT</h2>
            
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading data...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Month/Year Selector */}
                <div className="flex gap-2">
                  <div className="flex-1">
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
                  <div className="w-32">
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

                {/* Preview Table */}
                {currentWeek && (
                  <>
                    <div>
                      <h3 className="mb-2 text-sm font-medium text-muted-foreground">Preview:</h3>
                      <table className="w-full text-sm">
                        <thead className="border-b border-border">
                          <tr>
                            <th className="pb-2 text-left font-medium">Day</th>
                            <th className="pb-2 text-center font-medium">Entries</th>
                            <th className="pb-2 text-center font-medium">Late</th>
                            <th className="pb-2 text-center font-medium">Sign Out</th>
                            <th className="pb-2 text-right font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {currentWeek.days.map((day, idx) => (
                            <tr key={idx}>
                              <td className="py-2">{day.day}</td>
                              <td className="py-2 text-center">{day.entries}</td>
                              <td className="py-2 text-center">{day.late}</td>
                              <td className="py-2 text-center">{day.signOut}</td>
                              <td className="py-2 text-right font-mono">GHC {day.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          {currentWeek.days.length === 0 && (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-muted-foreground">
                                No entries for this week
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="border-t border-border pt-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Week Total:</span>
                        <span className="font-mono font-semibold">GHC {currentWeek.totalAmount.toFixed(2)}</span>
                      </div>
                    </div>

                    <Button className="w-full gap-2" onClick={handleWeeklyExport} disabled={exporting === 'weekly'}>
                      {exporting === 'weekly' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {exporting === 'weekly' ? 'Generating...' : 'Download Weekly Excel'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Monthly Export */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold">MONTHLY EXPORT</h2>
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
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
                <div className="w-32">
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

              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Month Total:</span>
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
