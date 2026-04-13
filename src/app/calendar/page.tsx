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
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, RefreshCw, CalendarDays } from 'lucide-react';

interface Holiday {
  id: string;
  date: string;
  isHoliday: boolean;
  holidayNote: string | null;
  source: 'google' | 'manual';
  isRemoved: boolean;
}

// Module-level cache: key = "YYYY-MM", shared across renders
const holidayCache = new Map<string, Holiday[]>();
const cacheTimestamps = new Map<string, number>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
// Track which years have been synced from Google Calendar
const syncedYears = new Set<number>();

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

  // Merge holidays for a month into state
  const mergeHolidaysIntoState = useCallback((holidayList: Holiday[]) => {
    setHolidays((prev) => {
      const next = { ...prev };
      holidayList.forEach((h) => {
        next[h.date] = h;
      });
      return next;
    });
  }, []);

  // Fetch holidays for a month from the database - always merges
  const fetchMonth = useCallback(async (date: Date) => {
    const cacheKey = format(date, 'yyyy-MM');
    const now = Date.now();
    const cached = holidayCache.get(cacheKey);
    const timestamp = cacheTimestamps.get(cacheKey);

    // If cache is fresh, apply it and skip the network request
    if (cached && timestamp && (now - timestamp) < CACHE_TTL) {
      mergeHolidaysIntoState(cached);
      return;
    }

    // If stale cache exists, apply it immediately for instant render
    if (cached) {
      mergeHolidaysIntoState(cached);
    }

    // Fetch fresh data from database
    try {
      const startDate = format(startOfMonth(date), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(date), 'yyyy-MM-dd');

      const response = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
      const data = await response.json();
      const holidayList: Holiday[] = Array.isArray(data) ? data : [];

      // Update cache
      holidayCache.set(cacheKey, holidayList);
      cacheTimestamps.set(cacheKey, now);

      // Merge fresh data into state
      mergeHolidaysIntoState(holidayList);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    }
  }, [mergeHolidaysIntoState]);

  // Fetch current month + adjacent months
  const loadMonth = useCallback(async (date: Date) => {
    await Promise.all([
      fetchMonth(date),
      fetchMonth(subMonths(date, 1)),
      fetchMonth(addMonths(date, 1)),
    ]);
  }, [fetchMonth]);

  // Load data whenever the viewed month changes
  useEffect(() => {
    loadMonth(currentMonth);
  }, [currentMonth, loadMonth]);

  // Sync Google Calendar holidays for a given year range
  const syncGoogleHolidays = useCallback(async (silent: boolean, years: number[]) => {
    // Filter out years already synced this session (unless forced via !silent)
    const yearsToSync = silent
      ? years.filter((y) => !syncedYears.has(y))
      : years;

    if (yearsToSync.length === 0) return;

    if (!silent) {
      setIsSyncing(true);
      setSyncMessage('Syncing...');
    }

    try {
      const response = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ years: yearsToSync }),
      });
      const data = await response.json();

      if (data.success) {
        const totalAdded = data.synced || 0;

        // Mark these years as synced
        yearsToSync.forEach((y) => syncedYears.add(y));

        if (!silent) {
          setSyncMessage(`Synced ${totalAdded} holiday${totalAdded !== 1 ? 's' : ''}`);
        }

        // Invalidate cache for all synced year months so fresh data loads
        for (const year of yearsToSync) {
          for (let m = 0; m < 12; m++) {
            const key = `${year}-${String(m + 1).padStart(2, '0')}`;
            holidayCache.delete(key);
            cacheTimestamps.delete(key);
          }
        }

        // Re-fetch current month and neighbors from database
        await loadMonth(currentMonth);
      } else if (!silent) {
        setSyncMessage('Sync failed');
      }
    } catch (error) {
      console.error('Failed to sync holidays:', error);
      if (!silent) {
        setSyncMessage('Sync failed');
      }
    }

    setTimeout(() => {
      setSyncMessage('');
      setIsSyncing(false);
    }, 3000);
  }, [currentMonth, loadMonth]);

  // Initial sync on mount: sync current year ± 1
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    syncGoogleHolidays(true, [currentYear - 1, currentYear, currentYear + 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync when year changes (navigate to a year we haven't synced yet)
  const lastSyncedYearRef = useRef<number | null>(null);
  useEffect(() => {
    const year = currentMonth.getFullYear();
    if (lastSyncedYearRef.current === null) {
      lastSyncedYearRef.current = year;
      return;
    }
    if (year !== lastSyncedYearRef.current) {
      lastSyncedYearRef.current = year;
      syncGoogleHolidays(true, [year - 1, year, year + 1]);
    }
  }, [currentMonth, syncGoogleHolidays]);

  // Manual sync button — force re-sync for viewed year ± 1
  async function handleManualSync() {
    const year = currentMonth.getFullYear();
    await syncGoogleHolidays(false, [year - 1, year, year + 1]);
  }

  async function toggleHoliday(date: Date, isChecked: boolean) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];

    // Optimistic update
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
        const result = await fetch('/api/calendar/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            isHoliday: true,
            holidayNote: editingName || 'Holiday',
            source: 'manual',
          }),
        });
        const saved = await result.json();
        if (saved.id && !saved.id.startsWith('temp-')) {
          setHolidays((prev) => ({
            ...prev,
            [dateStr]: {
              ...prev[dateStr],
              id: saved.id,
              holidayNote: saved.holidayNote,
            },
          }));
        }
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

  // Build calendar grid
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

  // Holidays for current month (for the badge)
  const monthHolidays = Object.values(holidays)
    .filter((h) => {
      if (!h.isHoliday || h.isRemoved) return false;
      const hDate = new Date(h.date + 'T00:00:00');
      return hDate.getMonth() === currentMonth.getMonth() &&
             hDate.getFullYear() === currentMonth.getFullYear();
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const holidayCount = monthHolidays.length;
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
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleManualSync} disabled={isSyncing}>
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
                <CalendarDays className="h-3.5 w-3.5" />
                {holidayCount} holiday{holidayCount > 1 ? 's' : ''} this month
              </div>
            )}

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {day}
                </div>
              ))}

              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="contents">
                  {week.map((day, dayIndex) => {
                    if (!day) return <div key={dayIndex} className="min-h-[72px]" />;

                    const holiday = getHolidayForDate(day);
                    const isHoliday = holiday?.isHoliday && !holiday?.isRemoved;
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isToday = isSameDay(day, today);
                    const holidayName = holiday?.holidayNote || '';
                    const dayOfWeek = day.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                    return (
                      <div key={dayIndex} className="min-h-[72px]">
                        <button
                          onClick={() => {
                            setSelectedDate(day);
                            setEditingName(holidayName || '');
                          }}
                          className={`relative flex h-full w-full flex-col items-start justify-start rounded-lg px-2 py-1.5 text-sm transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20'
                              : isToday
                              ? 'ring-2 ring-warning ring-offset-1 bg-warning/5'
                              : isHoliday
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/40'
                              : isWeekend
                              ? 'bg-muted/30 hover:bg-muted/50'
                              : 'hover:bg-accent border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={`text-sm font-semibold leading-none ${
                                isToday
                                  ? 'text-warning'
                                  : isHoliday
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : isWeekend
                                  ? 'text-muted-foreground'
                                  : isSelected
                                  ? 'text-primary-foreground'
                                  : ''
                              }`}
                            >
                              {format(day, 'd')}
                            </span>
                            {isHoliday && !isSelected && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            )}
                          </div>

                          {isHoliday && holidayName && (
                            <span
                              className={`mt-0.5 w-full truncate text-[11px] leading-snug font-medium ${
                                isSelected ? 'text-primary-foreground/90' : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                              title={holidayName}
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
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Holiday
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
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Holiday name (e.g., Independence Day)"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button size="sm" onClick={() => saveHolidayName(selectedDate, editingName)} className="h-8 shrink-0">
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        {holiday?.source && (
                          <p className="text-xs text-muted-foreground">
                            Source: {holiday.source === 'google' ? 'Google Calendar (synced)' : 'Manually added'}
                          </p>
                        )}
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