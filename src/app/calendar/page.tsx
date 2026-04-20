'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Calendar as CalendarIcon, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface Holiday {
  id: string;
  date: string;
  isHoliday: boolean;
  holidayNote: string | null;
  source: string | null;
  isRemoved: boolean | null;
}

export default function CalendarPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(true);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayNote, setNewHolidayNote] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [addMessage, setAddMessage] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchHolidays = useCallback(async () => {
    try {
      // Fetch holidays for the current year
      const year = new Date().getFullYear();
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        // Only show holidays (isHoliday=true and not removed)
        setHolidays(list.filter((h: Holiday) => h.isHoliday && !h.isRemoved));
      }
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    } finally {
      setLoadingHolidays(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleAddHoliday = async () => {
    if (!newHolidayName.trim() || !newHolidayDate) return;

    const res = await fetch('/api/calendar/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: newHolidayDate,
        isHoliday: true,
        holidayNote: newHolidayName.trim() + (newHolidayNote ? ` - ${newHolidayNote}` : ''),
        source: 'manual',
      }),
    });

    if (res.ok) {
      setNewHolidayName('');
      setNewHolidayNote('');
      setNewHolidayDate('');
      setAddMessage('Holiday added successfully');
      fetchHolidays();
    } else {
      setAddMessage('Failed to add holiday');
    }

    setTimeout(() => setAddMessage(''), 3000);
  };

  const handleRemoveHoliday = async (holiday: Holiday) => {
    setRemovingId(holiday.id);
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: holiday.date,
          isHoliday: false,
          holidayNote: null,
          source: holiday.source,
        }),
      });

      if (res.ok) {
        setHolidays((prev) => prev.filter((h) => h.id !== holiday.id));
      }
    } catch (error) {
      console.error('Failed to remove holiday:', error);
    } finally {
      setRemovingId(null);
    }
  };

  const formatHolidayDate = (dateStr: string) => {
    try {
      // The date from the DB is in YYYY-MM-DD format
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return format(date, 'EEE, MMM dd yyyy');
    } catch {
      return dateStr;
    }
  };

  const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <DashboardLayout title="Calendar">
      <div className="space-y-6">
        {/* Ghana Public Holidays - Google Calendar Embed */}
        <Card>
          <div className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Ghana Public Holidays</h2>
            <div className="w-full overflow-hidden rounded-lg border border-border" style={{ height: '600px' }}>
              <iframe
                src="https://calendar.google.com/calendar/embed?src=en.gh%23holiday%40group.v.calendar.google.com&ctz=Africa%2FAccra&showTitle=0&showPrint=0&showCalendars=0&mode=MONTH&showNav=1&showDate=1&showTz=0"
                style={{ border: 0, width: '100%', height: '100%' }}
                frameBorder="0"
                scrolling="no"
                title="Ghana Public Holidays Calendar"
              />
            </div>
          </div>
        </Card>

        {/* Custom Holidays List */}
        <Card>
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Custom Holidays</h2>
                <span className="text-xs text-muted-foreground rounded-full bg-muted/20 px-2 py-0.5">
                  {holidays.length} total
                </span>
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setLoadingHolidays(true); fetchHolidays(); }}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {loadingHolidays ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading holidays...
              </div>
            ) : sortedHolidays.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No custom holidays set</p>
                <p className="text-xs mt-1">Add holidays below to exclude them from lateness tracking</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border bg-card">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedHolidays.map((holiday) => (
                      <tr key={holiday.id} className="hover:bg-card/50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">
                          {formatHolidayDate(holiday.date)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {holiday.holidayNote || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            holiday.source === 'google'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-success/10 text-success'
                          }`}>
                            {holiday.source === 'google' ? 'Google' : 'Manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-danger"
                            onClick={() => handleRemoveHoliday(holiday)}
                            disabled={removingId === holiday.id}
                            title="Remove holiday"
                          >
                            {removingId === holiday.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Add Custom Holiday */}
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-sm mb-3">Add Custom Holiday</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="holiday-name">Name *</Label>
                <Input id="holiday-name" placeholder="e.g. Local Festival" value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="holiday-date">Date *</Label>
                <Input id="holiday-date" type="date" value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="holiday-note">Note (optional)</Label>
                <Input id="holiday-note" placeholder="Description" value={newHolidayNote}
                  onChange={(e) => setNewHolidayNote(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <Button size="sm" onClick={handleAddHoliday} disabled={!newHolidayName.trim() || !newHolidayDate} className="h-8 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Holiday
              </Button>
              {addMessage && (
                <span className={`text-xs font-medium ${addMessage.includes('success') ? 'text-success' : 'text-danger'}`}>
                  {addMessage}
                </span>
              )}
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}