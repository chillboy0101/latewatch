// app/calendar/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, RefreshCw, Globe } from 'lucide-react';

interface Holiday {
  id: string;
  date: string;
  isHoliday: boolean;
  holidayNote: string | null;
  source: 'google' | 'manual';
  isRemoved: boolean;
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [holidays, setHolidays] = useState<Record<string, Holiday>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncedAt: string | null; message: string }>({
    lastSyncedAt: null,
    message: '',
  });
  const [loading, setLoading] = useState(true);

  // Fetch last sync status on page load (no auto-sync)
  useEffect(() => {
    fetchHolidays();
    fetchLastSyncStatus();
  }, []);

  async function fetchLastSyncStatus() {
    try {
      const response = await fetch('/api/calendar/sync');
      const data = await response.json();
      if (data.lastSyncedAt) {
        setSyncStatus({
          lastSyncedAt: data.lastSyncedAt,
          message: data.message || 'Ready to sync',
        });
      }
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
    }
  }

  async function fetchHolidays() {
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const startDate = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd');
      
      const response = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
      const data = await response.json();
      
      const holidayMap: Record<string, Holiday> = {};
      data.forEach((h: Holiday) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHolidays();
  }, [currentMonth]);

  async function handleSync() {
    setSyncing(true);
    try {
      const response = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        setSyncStatus({
          lastSyncedAt: data.syncedAt,
          message: data.message,
        });
        fetchHolidays();
      } else {
        setSyncStatus({
          lastSyncedAt: null,
          message: data.message || 'Sync failed',
        });
      }
    } catch (error) {
      setSyncStatus({ lastSyncedAt: null, message: 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }

  async function toggleHoliday(date: Date, isHoliday: boolean) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];
    
    if (existing) {
      await fetch(`/api/calendar/holidays/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHoliday, isRemoved: !isHoliday }),
      });
    } else {
      await fetch('/api/calendar/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, isHoliday, holidayNote: '', source: 'manual' }),
      });
    }
    fetchHolidays();
  }

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDay = getDay(monthStart);

  const weeks: (Date | null)[][] = [];
  let currentWeek: (Date | null)[] = [];

  for (let i = 0; i < startDay; i++) {
    currentWeek.push(null);
  }

  days.forEach((day, index) => {
    currentWeek.push(day);
    if (currentWeek.length === 7 || index === days.length - 1) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });

  const getHolidayForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return holidays[dateStr];
  };

  return (
    <DashboardLayout title="Calendar">
      <div className="space-y-6">
        {/* Sync Status Bar */}
        <Card>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Ghana Public Holidays</p>
                <p className="text-xs text-muted-foreground">
                  {syncStatus.lastSyncedAt
                    ? `Last synced: ${format(new Date(syncStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                    : 'Not synced yet'}
                </p>
              </div>
              {syncStatus.message && (
                <span className="rounded-full bg-success/10 px-2 py-1 text-xs text-success">
                  {syncStatus.message}
                </span>
              )}
            </div>
            <Button onClick={handleSync} disabled={syncing} size="sm">
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            {/* Month Navigation */}
            <div className="mb-6 flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-xl font-semibold">
                {format(currentMonth, 'MMMM yyyy')}
              </h2>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Calendar Grid */}
            {loading ? (
              <div className="flex h-64 items-center justify-center text-muted-foreground">
                Loading holidays...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="py-2 text-center text-xs font-medium text-muted-foreground">
                      {day}
                    </div>
                  ))}

                  {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="contents">
                      {week.map((day, dayIndex) => {
                        if (!day) return <div key={dayIndex} className="p-1" />;

                        const holiday = getHolidayForDate(day);
                        const isHoliday = holiday?.isHoliday && !holiday?.isRemoved;
                        const isSelected = selectedDate && isSameDay(day, selectedDate);
                        const isToday = isSameDay(day, new Date());
                        const holidayName = holiday?.holidayNote || (holiday?.source === 'google' ? 'Holiday' : '');

                        return (
                          <div key={dayIndex} className="p-1">
                            <button
                              onClick={() => setSelectedDate(day)}
                              className={`relative flex h-16 w-full flex-col items-start justify-start rounded-lg px-1.5 py-1 text-sm transition-colors ${
                                isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : isToday
                                  ? 'ring-2 ring-warning ring-offset-1'
                                  : isHoliday
                                  ? 'bg-success/10 hover:bg-success/20'
                                  : 'hover:bg-card'
                              }`}
                            >
                              {/* Day Number */}
                              <span className={`text-sm font-medium ${
                                isToday ? 'font-bold text-warning' : 
                                isHoliday ? 'text-success' : ''
                              }`}>
                                {format(day, 'd')}
                              </span>
                              
                              {/* Holiday Name - shown like Google Calendar */}
                              {isHoliday && holidayName && (
                                <span className={`mt-0.5 w-full truncate text-[10px] leading-tight ${
                                  isSelected ? 'text-primary-foreground/80' : 'text-success'
                                }`}>
                                  {holidayName}
                                </span>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-warning" /> Today
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-success" /> Holiday
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Selected Date Editor */}
        {selectedDate && (
          <Card>
            <div className="p-6">
              <h3 className="mb-4 font-semibold">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </h3>
              {(() => {
                const holiday = getHolidayForDate(selectedDate);
                const isMarked = holiday?.isHoliday && !holiday?.isRemoved;

                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="isHoliday"
                        checked={!!isMarked}
                        onChange={(e) => toggleHoliday(selectedDate, e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <label htmlFor="isHoliday" className="text-sm font-medium">
                        Mark as Holiday
                      </label>
                    </div>
                  </div>
                );
              })()}
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
