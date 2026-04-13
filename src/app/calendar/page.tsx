// app/calendar/page.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isBefore,
  startOfDay,
  addMonths,
  subMonths,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
} from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, RefreshCw } from 'lucide-react';

interface Holiday {
  id: string;
  date: string;
  isHoliday: boolean;
  holidayNote: string | null;
  source: 'google' | 'manual';
  isRemoved: boolean;
}

// In-memory cache for holidays: key = "YYYY-MM"
const holidayCache = new Map<string, Holiday[]>();
const cacheTimestamps = new Map<string, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [holidays, setHolidays] = useState<Record<string, Holiday>>({});
  const [editingName, setEditingName] = useState('');
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error' | 'syncing' | null; message: string }>({
    type: null,
    message: '',
  });
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const yearDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(event.target as Node)) {
        setShowMonthDropdown(false);
      }
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target as Node)) {
        setShowYearDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch holidays with caching
  const fetchHolidays = useCallback(async (date: Date, silent = true) => {
    const cacheKey = format(date, 'yyyy-MM');
    const now = Date.now();
    const cached = holidayCache.get(cacheKey);
    const timestamp = cacheTimestamps.get(cacheKey);

    // Return cached data if fresh
    if (cached && timestamp && (now - timestamp) < CACHE_TTL) {
      const holidayMap: Record<string, Holiday> = {};
      cached.forEach((h) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
      return;
    }

    try {
      const startDate = format(startOfMonth(date), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(date), 'yyyy-MM-dd');

      const response = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
      const data = await response.json();
      const holidayList = Array.isArray(data) ? data : [];

      // Update cache
      holidayCache.set(cacheKey, holidayList);
      cacheTimestamps.set(cacheKey, now);

      const holidayMap: Record<string, Holiday> = {};
      holidayList.forEach((h: Holiday) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    }
  }, []);

  // Pre-fetch adjacent months in background
  const prefetchAdjacentMonths = useCallback((date: Date) => {
    const prevMonth = subMonths(date, 1);
    const nextMonth = addMonths(date, 1);
    fetchHolidays(prevMonth, true);
    fetchHolidays(nextMonth, true);
  }, [fetchHolidays]);

  // Initial load
  useEffect(() => {
    fetchHolidays(currentMonth, false);
    prefetchAdjacentMonths(currentMonth);
  }, []);

  // When month changes
  useEffect(() => {
    fetchHolidays(currentMonth, true);
    prefetchAdjacentMonths(currentMonth);
  }, [currentMonth, fetchHolidays, prefetchAdjacentMonths]);

  // Trigger auto-sync in background
  useEffect(() => {
    handleSync(true);
  }, []);

  async function handleSync(silent = false) {
    if (!silent) {
      setSyncStatus({ type: 'syncing', message: 'Syncing holidays...' });
    }
    try {
      const response = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        setSyncStatus({ type: 'success', message: data.message || `Synced ${data.synced} holidays` });
        // Refresh holidays after sync
        fetchHolidays(currentMonth, false);
      } else {
        setSyncStatus({ type: 'error', message: data.message || 'Sync failed' });
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncStatus({ type: 'error', message: 'Sync failed - check API key' });
    }
    
    // Clear status after 5 seconds
    setTimeout(() => setSyncStatus({ type: null, message: '' }), 5000);
  }

  async function toggleHoliday(date: Date, isChecked: boolean) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];

    // Optimistically update local state immediately
    if (existing) {
      setHolidays((prev) => ({
        ...prev,
        [dateStr]: {
          ...existing,
          isHoliday: isChecked,
          isRemoved: !isChecked,
        },
      }));
    } else if (isChecked) {
      setHolidays((prev) => ({
        ...prev,
        [dateStr]: {
          id: 'temp-' + Date.now(),
          date: dateStr,
          isHoliday: true,
          isRemoved: false,
          holidayNote: editingName || 'Holiday',
          source: 'manual',
        },
      }));
    }

    // Persist to database
    try {
      if (existing) {
        await fetch(`/api/calendar/holidays/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isHoliday: isChecked, isRemoved: !isChecked }),
        });
      } else if (isChecked) {
        await fetch('/api/calendar/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            isHoliday: true,
            holidayNote: editingName || 'Holiday',
            source: 'manual',
          }),
        });
      }
      // Refresh cache
      fetchHolidays(currentMonth, true);
    } catch (error) {
      console.error('Failed to update holiday:', error);
      fetchHolidays(currentMonth, true);
    }
  }

  async function saveHolidayName(date: Date, name: string) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];

    if (existing) {
      await fetch(`/api/calendar/holidays/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holidayNote: name }),
      });
      fetchHolidays(currentMonth, true);
    }
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

  const yearStart = startOfYear(new Date());
  const yearEnd = endOfYear(new Date());
  const yearOptions = eachMonthOfInterval({ start: addMonths(yearStart, -24), end: addMonths(yearEnd, 12) });

  return (
    <DashboardLayout title="Calendar">
      <div className="space-y-6">
        <Card>
          <div className="p-6">
            {/* Month/Year Navigation - Google Calendar Style */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Month Dropdown */}
                <div className="relative" ref={monthDropdownRef}>
                  <Button
                    variant="ghost"
                    className="gap-1 font-semibold text-lg"
                    onClick={() => {
                      setShowMonthDropdown(!showMonthDropdown);
                      setShowYearDropdown(false);
                    }}
                  >
                    {format(currentMonth, 'MMMM')}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  {showMonthDropdown && (
                    <div className="absolute left-0 top-full z-50 mt-1 grid w-48 grid-cols-3 gap-1 rounded-lg border border-border bg-card p-2 shadow-lg">
                      {Array.from({ length: 12 }, (_, i) => {
                        const monthDate = new Date(currentMonth.getFullYear(), i, 1);
                        const isSelected = i === currentMonth.getMonth();
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              setCurrentMonth(monthDate);
                              setShowMonthDropdown(false);
                            }}
                            className={`rounded px-2 py-1.5 text-sm hover:bg-accent ${
                              isSelected ? 'bg-primary text-primary-foreground font-medium' : ''
                            }`}
                          >
                            {format(monthDate, 'MMM')}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Year Dropdown */}
                <div className="relative" ref={yearDropdownRef}>
                  <Button
                    variant="ghost"
                    className="gap-1 font-semibold text-lg"
                    onClick={() => {
                      setShowYearDropdown(!showYearDropdown);
                      setShowMonthDropdown(false);
                    }}
                  >
                    {format(currentMonth, 'yyyy')}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  {showYearDropdown && (
                    <div className="absolute left-0 top-full z-50 mt-1 grid w-32 grid-cols-3 gap-1 rounded-lg border border-border bg-card p-2 shadow-lg max-h-60 overflow-y-auto">
                      {Array.from({ length: 21 }, (_, i) => {
                        const year = new Date().getFullYear() - 10 + i;
                        const isSelected = year === currentMonth.getFullYear();
                        return (
                          <button
                            key={year}
                            onClick={() => {
                              setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
                              setShowYearDropdown(false);
                            }}
                            className={`rounded px-2 py-1.5 text-sm hover:bg-accent ${
                              isSelected ? 'bg-primary text-primary-foreground font-medium' : ''
                            }`}
                          >
                            {year}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Sync Status & Buttons */}
              <div className="flex items-center gap-2">
                {syncStatus.type && (
                  <span className={`text-sm ${
                    syncStatus.type === 'success' ? 'text-success' : 
                    syncStatus.type === 'error' ? 'text-danger' : 
                    'text-muted-foreground'
                  }`}>
                    {syncStatus.message}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync(false)}
                  disabled={syncStatus.type === 'syncing'}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncStatus.type === 'syncing' ? 'animate-spin' : ''}`} />
                  Sync Holidays
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentMonth(new Date());
                    setSelectedDate(new Date());
                  }}
                >
                  Today
                </Button>
              </div>
            </div>

            {/* Calendar Grid */}
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
                    const holidayName = holiday?.holidayNote || '';
                    const dayOfWeek = day.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                    return (
                      <div key={dayIndex} className="p-1">
                        <button
                          onClick={() => {
                            setSelectedDate(day);
                            setEditingName(holidayName || '');
                          }}
                          className={`relative flex h-16 w-full flex-col items-start justify-start rounded-lg px-1.5 py-1 text-sm transition-colors ${
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : isToday
                              ? 'ring-2 ring-warning ring-offset-1'
                              : isHoliday
                              ? 'bg-success/10 hover:bg-success/20'
                              : isWeekend
                              ? 'bg-muted/30 hover:bg-muted/50'
                              : 'hover:bg-card'
                          }`}
                        >
                          <span
                            className={`text-sm font-medium ${
                              isToday
                                ? 'font-bold text-warning'
                                : isHoliday
                                ? 'text-success'
                                : isWeekend
                                ? 'text-muted-foreground'
                                : ''
                            }`}
                          >
                            {format(day, 'd')}
                          </span>

                          {isHoliday && holidayName && (
                            <span
                              className={`mt-0.5 w-full truncate text-[10px] leading-tight ${
                                isSelected ? 'text-primary-foreground/80' : 'text-success'
                              }`}
                            >
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
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" /> Today
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" /> Holiday
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-muted" /> Weekend
              </span>
              <span className="text-muted-foreground">
                Working days: Mon - Fri
              </span>
            </div>
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
                const isPast = isBefore(startOfDay(selectedDate), startOfDay(new Date()));
                const dayOfWeek = selectedDate.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="isHoliday"
                        checked={!!isMarked}
                        onChange={(e) => toggleHoliday(selectedDate, e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        disabled={isWeekend}
                      />
                      <label htmlFor="isHoliday" className="text-sm font-medium">
                        Mark as Holiday
                        {isPast && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            Past Date
                          </span>
                        )}
                        {isWeekend && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Weekend (not editable)
                          </span>
                        )}
                      </label>
                    </div>

                    {isMarked && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Holiday Name</label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g., Independence Day"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                          />
                          <Button size="sm" onClick={() => saveHolidayName(selectedDate, editingName)}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
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
