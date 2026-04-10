// app/calendar/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isBefore, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState('');

  // Auto-sync on page load
  useEffect(() => {
    triggerSync();
  }, []);

  // Fetch holidays when month changes (silent - no loading spinner)
  useEffect(() => {
    fetchHolidays(true);
  }, [currentMonth]);

  async function triggerSync() {
    try {
      await fetch('/api/calendar/sync', { method: 'POST' });
    } catch (error) {
      console.error('Auto-sync failed:', error);
    }
  }

  async function fetchHolidays(silent = false) {
    if (!silent) setLoading(true);
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const startDate = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd');
      
      const response = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
      const data = await response.json();
      
      const holidayList = Array.isArray(data) ? data : [];
      const holidayMap: Record<string, Holiday> = {};
      holidayList.forEach((h: Holiday) => {
        holidayMap[h.date] = h;
      });
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function toggleHoliday(date: Date, isChecked: boolean) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = holidays[dateStr];
    
    // Optimistically update local state immediately
    if (existing) {
      setHolidays(prev => ({
        ...prev,
        [dateStr]: {
          ...existing,
          isHoliday: isChecked,
          isRemoved: !isChecked,
        }
      }));
    } else if (isChecked) {
      setHolidays(prev => ({
        ...prev,
        [dateStr]: {
          id: 'temp',
          date: dateStr,
          isHoliday: true,
          isRemoved: false,
          holidayNote: editingName || 'Holiday',
          source: 'manual',
        }
      }));
    }
    
    // Persist to database in background
    try {
      if (existing) {
        await fetch(`/api/calendar/holidays/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            isHoliday: isChecked, 
            isRemoved: !isChecked,
          }),
        });
      } else if (isChecked) {
        await fetch('/api/calendar/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            date: dateStr, 
            isHoliday: true, 
            holidayNote: editingName || 'Holiday', 
            source: 'manual' 
          }),
        });
      }
      // Silent refresh from database
      fetchHolidays(true);
    } catch (error) {
      console.error('Failed to update holiday:', error);
      // Revert on error
      fetchHolidays(true);
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
                        const holidayName = holiday?.holidayNote || '';

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
                                  : 'hover:bg-card'
                              }`}
                            >
                              <span className={`text-sm font-medium ${
                                isToday ? 'font-bold text-warning' : 
                                isHoliday ? 'text-success' : ''
                              }`}>
                                {format(day, 'd')}
                              </span>
                              
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
                const isPast = isBefore(startOfDay(selectedDate), startOfDay(new Date()));

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
                        {isPast && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            Past Date
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
                          <Button
                            size="sm"
                            onClick={() => saveHolidayName(selectedDate, editingName)}
                          >
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
