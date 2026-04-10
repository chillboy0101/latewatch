// app/exports/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Upload, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, eachWeekOfInterval, parseISO, subMonths, addMonths } from 'date-fns';

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
      const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd });
      
      const summaries: WeekSummary[] = [];
      let monthTotal = 0;
      let weekIdx = 0;

      for (const weekStart of weeks) {
        const weekEnd = addDays(weekStart, 4); // Friday
        if (weekStart > monthEnd) break;

        const days: DayData[] = [];
        let weekEntries = 0, weekLate = 0, weekSignOut = 0, weekAmount = 0;

        for (let i = 0; i < 5; i++) { // Mon-Fri
          const day = addDays(weekStart, i);
          if (day > monthEnd) break;

          const dateStr = format(day, 'yyyy-MM-dd');
          const dayName = format(day, 'EEE dd');
          
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

        summaries.push({
          weekStart: format(weekStart, 'yyyy-MM-dd'),
          weekEnd: format(weekEnd, 'yyyy-MM-dd'),
          weekLabel: `Week ${weekIdx + 1} (${format(weekStart, 'MMM dd')} - ${format(weekEnd, 'MMM dd')})`,
          days,
          totalEntries: weekEntries,
          totalLate: weekLate,
          totalSignOut: weekSignOut,
          totalAmount: weekAmount,
        });
        weekIdx++;
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
                {/* Month Selector */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Select Month</label>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" className="flex-1 justify-center">
                      {format(selectedMonth, 'MMMM yyyy')}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
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
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Select Month</label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="flex-1 justify-center">
                    {format(selectedMonth, 'MMMM yyyy')}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
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

        {/* Template Management */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold">TEMPLATE MANAGEMENT (Admin)</h2>
            <div className="space-y-4">
              <div className="text-sm">
                <div className="mb-1">
                  <span className="text-muted-foreground">Active Template:</span>{' '}
                  <span className="font-medium">LATENESS BOOK MARCH 2026.xlsx (v1)</span>
                </div>
                <div className="text-muted-foreground">
                  Last Updated: 2026-03-01 by admin@company.com
                </div>
              </div>

              <Button variant="outline" className="w-full gap-2">
                <Upload className="h-4 w-4" />
                Upload New Template
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
