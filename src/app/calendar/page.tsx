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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [holidays, setHolidays] = useState<Record<string, Holiday>>({});
  const [editingName, setEditingName] = useState('');
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
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

  // Fetch holidays with caching - INSTANT, no blocking
  const fetchHolidays = useCallback(async (date: Date) => {
    const cacheKey = format(date, 'yyyy-MM');
    const now = Date.now();
    const cached = holidayCache.get(cacheKey);
    const timestamp = cacheTimestamps.get(cacheKey);

    // Return cached data immediately if fresh
    if (cached && timestamp && (now - timestamp) < CACHE_TTL) {
      const holidayMap: Record<string, Holiday> = {};
      cached.forEach((h) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
      return;
    }

    // Fetch in background - don't block UI
    try {
      const startDate = format(startOfMonth(date), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(date), 'yyyy-MM-dd');

      const response = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
      const data = await response.json();
      const holidayList = Array.isArray(data) ? data : [];

      // Update cache immediately
      holidayCache.set(cacheKey, holidayList);
      cacheTimestamps.set(cacheKey, now);

      const holidayMap: Record<string, Holiday> = {};
      holidayList.forEach((h: Holiday) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
    } catch (error) {
      // Silent fail - don't block UI
      console.error('Failed to fetch holidays:', error);
    }
  }, []);

  // Pre-fetch adjacent months in background
  const prefetchAdjacentMonths = useCallback((date: Date) => {
    const prevMonth = subMonths(date, 1);
    const nextMonth = addMonths(date, 1);
    fetchHolidays(prevMonth);
    fetchHolidays(nextMonth);
  }, [fetchHolidays]);

  // Initial load - fetch immediately
  useEffect(() => {
    fetchHolidays(currentMonth);
    prefetchAdjacentMonths(currentMonth);
  }, []);

  // When month changes - instant switch
  useEffect(() => {
    fetchHolidays(currentMonth);
    prefetchAdjacentMonths(currentMonth);
  }, [currentMonth, fetchHolidays, prefetchAdjacentMonths]);

  // Auto-sync from Google Calendar on page load (silent)
  useEffect(() => {
    handleSync(true);
  }, []);

  async function handleSync(silent = false) {
    if (!silent) {
      setIsSyncing(true);
      setSyncMessage('Syncing...');
    }
    try {
      const response = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        setSyncMessage(`Added ${data.synced || 0} holidays`);
        // Refresh current month holidays after sync
        holidayCache.delete(format(currentMonth, 'yyyy-MM'));
        fetchHolidays(currentMonth);
      } else {
        // Silent fail - don't show error to user
        setSyncMessage('');
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncMessage('');
    }
    
    // Clear status after 3 seconds
    setTimeout(() => {
      setSyncMessage('');
      setIsSyncing(false);
    }, 3000);
  }

  async function toggleHoliday(date: Date, isChecked: boolean) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];

    // Update state instantly (optimistic)
    if (existing) {
      setHolidays((prev) => ({
        ...prev,
        [dateStr]: { ...existing, isHoliday: isChecked, isRemoved: !isChecked },
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
    } catch (error) {
      console.error('Failed to update holiday:', error);
    }
  }

  async function saveHolidayName(date: Date, name: string) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];

    if (existing) {
      setHolidays((prev) => ({
        ...prev,
        [dateStr]: { ...existing, holidayNote: name },
      }));
      await fetch(`/api/calendar/holidays/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holidayNote: name }),
      });
    }
  }

  // Build calendar grid - INSTANT, no loading
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

  // Count holidays for current month
  const holidayCount = Object.values(holidays).filter((h) => h.isHoliday && !h.isRemoved).length;
  const today = new Date();

  return (
    <DashboardLayout title="Calendar">
      <div className="space-y-4">
        <Card>
          <div className="p-5">
            {/* Header with Month/Year Navigation */}
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Month Dropdown */}
                <div className="relative" ref={monthDropdownRef}>
                  <Button
                    variant="ghost"
                    className="gap-1 font-semibold h-8 px-2"
                    onClick={() => {
                      setShowMonthDropdown(!showMonthDropdown);
                      setShowYearDropdown(false);
                    }}
                  >
                    {format(currentMonth, 'MMMM')}
                    <ChevronDown className="h-3 w-3" />
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
                    className="gap-1 font-semibold h-8 px-2"
                    onClick={() => {
                      setShowYearDropdown(!showYearDropdown);
                      setShowMonthDropdown(false);
                    }}
                  >
                    {format(currentMonth, 'yyyy')}
                    <ChevronDown className="h-3 w-3" />
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

                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Sync Button & Today Button */}
              <div className="flex items-center gap-2">
                {syncMessage && (
                  <span className="text-xs text-success font-medium">
                    {syncMessage}
                  </span>
                )}
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => handleSync(false)} disabled={isSyncing}>
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setCurrentMonth(new Date());
                    setSelectedDate(new Date());
                  }}
                >
                  Today
                </Button>
              </div>
            </div>

            {/* Holiday Count Badge */}
            {holidayCount > 0 && (
              <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {holidayCount} holiday{holidayCount > 1 ? 's' : ''} this month
              </div>
            )}

            {/* Calendar Grid - Always visible, instant render */}
            <div className="grid grid-cols-7 gap-1.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
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
                    const isToday = isSameDay(day, today);
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
                          className={`relative flex h-16 w-full flex-col items-start justify-start rounded-xl px-2 py-1.5 text-sm transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-md'
                              : isToday
                              ? 'ring-2 ring-warning ring-offset-1 bg-warning/5'
                              : isHoliday
                              ? 'bg-success/10 hover:bg-success/20 border border-success/20'
                              : isWeekend
                              ? 'bg-muted/30 hover:bg-muted/50'
                              : 'hover:bg-card border border-transparent'
                          }`}
                        >
                          <span
                            className={`text-sm font-semibold ${
                              isToday
                                ? 'text-warning'
                                : isHoliday
                                ? 'text-success'
                                : isWeekend
                                ? 'text-muted-foreground'
                                : isSelected
                                ? 'text-primary-foreground'
                                : ''
                            }`}
                          >
                            {format(day, 'd')}
                          </span>

                          {isHoliday && holidayName && (
                            <span
                              className={`mt-1 w-full truncate text-[10px] leading-tight font-medium ${
                                isSelected ? 'text-primary-foreground/90' : 'text-success'
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
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-warning" /> Today
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> Holiday
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-muted" /> Weekend
              </span>
            </div>
          </div>
        </Card>

        {/* Selected Date Editor */}
        {selectedDate && (
          <Card>
            <div className="p-4">
              <h3 className="mb-3 font-semibold text-sm">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </h3>
              {(() => {
                const holiday = getHolidayForDate(selectedDate);
                const isMarked = holiday?.isHoliday && !holiday?.isRemoved;
                const dayOfWeek = selectedDate.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="isHoliday"
                        checked={!!isMarked}
                        onChange={(e) => toggleHoliday(selectedDate, e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        disabled={isWeekend}
                      />
                      <label htmlFor="isHoliday" className="text-sm font-medium cursor-pointer">
                        Mark as Holiday
                        {isWeekend && (
                          <span className="ml-2 text-xs text-muted-foreground">(Weekends not editable)</span>
                        )}
                      </label>
                    </div>

                    {isMarked && (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Holiday name (e.g., Independence Day)"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8 text-sm"
                        />
                        <Button size="sm" onClick={() => saveHolidayName(selectedDate, editingName)} className="h-8">
                          <Plus className="h-3 w-3" />
                        </Button>
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
