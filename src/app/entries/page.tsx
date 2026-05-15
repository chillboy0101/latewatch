'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { Save, CheckCircle, AlertCircle, ChevronLeft, ChevronRight, Clock, RefreshCw } from 'lucide-react';
import { computePenalty } from '@/lib/penalty-calculator';
import { getAccraDateKey } from '@/lib/date-key';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';

interface StaffMember {
  id: string;
  fullName: string;
  active?: boolean | null;
  archived?: boolean | null;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
}

interface Entry {
  staffId: string;
  arrivalTime: string;
  didNotSignOut: boolean;
  amount: number;
  isGeneralPardon: boolean;
  reason: string;
}

interface CalendarDay {
  isHoliday?: boolean | null;
  isRemoved?: boolean | null;
  holidayNote?: string | null;
}

interface ExistingEntry {
  staffId: string;
  arrivalTime: string | null;
  didNotSignOut: boolean | null;
  computedAmount: string | number | null;
  isGeneralPardon?: boolean | null;
  reason: string | null;
}

function normalizeTimeValue(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '';
}

export default function EntriesPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => parseISO(getAccraDateKey()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStaffAndEntries = useCallback(async () => {
    try {
      setLoading(true);
      const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');

      // Fetch all data in parallel
      const [staffResponse, calendarResponse, entriesResponse] = await Promise.all([
        fetch('/api/staff', { cache: 'no-store' }),
        fetch(`/api/calendar?start=${selectedDateKey}&end=${selectedDateKey}`, { cache: 'no-store' }),
        fetch(`/api/entries?date=${selectedDateKey}`, { cache: 'no-store' }),
      ]);

      const [staffData, calendarData, entriesData] = await Promise.all([
        staffResponse.json(),
        calendarResponse.json(),
        entriesResponse.json(),
      ]);

      const allStaffList = Array.isArray(staffData) ? staffData as StaffMember[] : [];

      const calendarDays = Array.isArray(calendarData) ? calendarData as CalendarDay[] : [];
      const holiday = calendarDays.find((h) => h.isHoliday && !h.isRemoved) ?? null;
      setIsHoliday(!!holiday);
      setHolidayName(holiday?.holidayNote || 'Holiday');

      const entriesList = Array.isArray(entriesData) ? entriesData as ExistingEntry[] : [];
      const entryStaffIds = new Set(entriesList.map((entry) => entry.staffId));
      const displayStaff = allStaffList.filter((member) =>
        (member.active === true && member.archived !== true) || entryStaffIds.has(member.id)
      );

      setStaff(displayStaff);

      const mergedEntries = displayStaff.map((s: StaffMember) => {
        const existing = entriesList.find((e) => e.staffId === s.id);
        return {
          staffId: s.id,
          arrivalTime: normalizeTimeValue(existing?.arrivalTime),
          didNotSignOut: existing?.didNotSignOut || false,
          amount: existing ? parseFloat(String(existing.computedAmount || '0')) : 0,
          isGeneralPardon: existing?.isGeneralPardon === true,
          reason: existing?.reason || '',
        };
      });

      setEntries(mergedEntries);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchStaffAndEntries();
  }, [fetchStaffAndEntries]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['entries', 'dashboard'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: fetchStaffAndEntries,
          }),
        ),
      );

      if (mounted) {
        cleanups = unsubscribers;
      } else {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      }
    })();

    return () => {
      mounted = false;
      cleanups.forEach((unsubscribe) => unsubscribe());
    };
  }, [fetchStaffAndEntries]);

  
  const updateEntry = <K extends keyof Entry>(staffId: string, field: K, value: Entry[K]) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId === staffId) {
          const updated = { ...entry, [field]: value };
          const member = staff.find((s) => s.id === staffId);
          if (entry.isGeneralPardon && updated.didNotSignOut !== true) {
            return {
              ...updated,
              amount: 0,
              isGeneralPardon: true,
              reason: updated.reason || 'General pardon',
            };
          }
          const penalty = computePenalty({
            arrivalTime: updated.arrivalTime || null,
            didNotSignOut: updated.didNotSignOut,
            isAttendanceOnly: member?.isAttendanceOnly === true,
            isNssPersonnel: member?.isNssPersonnel === true,
            isHoliday,
          });
          return {
            ...updated,
            amount: penalty.amount,
            isGeneralPardon: false,
            reason: penalty.reason,
          };
        }
        return entry;
      })
    );
  };

  async function handleSaveAll() {
    setSaving(true);
    setMessage(null);
    try {
      const today = format(selectedDate, 'yyyy-MM-dd');
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today,
          entries: entries,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const savedCount = Number(data.count || 0);
        const deletedCount = Number(data.deletedCount || 0);
        const totalChanges = savedCount + deletedCount;
        setMessage({
          type: 'success',
          text: totalChanges > 0
            ? `${totalChanges} entr${totalChanges === 1 ? 'y' : 'ies'} updated successfully`
            : 'Entries submitted for this date with no late arrivals',
        });
        // Re-fetch fresh data from DB so saved entries display immediately
        setTimeout(() => fetchStaffAndEntries(), 50);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || 'Failed to save lateness entries' });
      }
    } catch (error) {
      console.error('Failed to save lateness entries:', error);
      setMessage({ type: 'error', text: 'Failed to save lateness entries' });
    } finally {
      setSaving(false);
      // Auto-dismiss message after 5 seconds
      setTimeout(() => setMessage(null), 5000);
    }
  }

  function changeSelectedDate(nextDate: Date) {
    setSelectedDate(nextDate);
    setMessage(null);
  }

  function handleDateInputChange(value: string) {
    const parsed = parseISO(value);
    if (isValid(parsed)) {
      changeSelectedDate(parsed);
    }
  }

  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const isWeekend = selectedDate.getDay() === 0 || selectedDate.getDay() === 6;
  const entriesDisabled = isHoliday || isWeekend;

  const totals = entries.reduce(
    (acc, entry) => ({
      late: acc.late + (entry.amount > 0 && !entry.reason.includes('SIGN OUT') ? 1 : 0),
      onTime: acc.onTime + (entry.amount === 0 && !entry.didNotSignOut ? 1 : 0),
      didNotSignOut: acc.didNotSignOut + (entry.didNotSignOut ? 1 : 0),
      totalAmount: acc.totalAmount + entry.amount,
    }),
    { late: 0, onTime: 0, didNotSignOut: 0, totalAmount: 0 }
  );

  if (loading) {
    return (
      <DashboardLayout title="Lateness Entries">
        <LoadingBuffer
          variant="page"
          label="Loading lateness entries"
          description="Checking staff, holidays, and saved lateness records."
        />
      </DashboardLayout>
    );
  }

  if (staff.length === 0) {
    return (
      <DashboardLayout title="Lateness Entries">
        <div className="space-y-6">
          <Card>
            <div className="p-8 text-center">
              <p className="text-lg mb-2">No staff members found</p>
              <p className="text-sm text-muted-foreground mb-4">Please add staff members first before recording lateness entries</p>
              <Button onClick={() => window.location.href = '/staff'}>
                Go to Staff Management
              </Button>
            </div>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Lateness Entries">
      <div className="space-y-6">
        {/* Success/Error Message */}
        {message && (
          <div className={`flex items-center gap-3 rounded-lg border p-4 ${
            message.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        {/* Holiday Warning */}
        {(isHoliday || isWeekend) && (
          <Card className="overflow-hidden border-warning/30 bg-warning/5">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{isWeekend ? 'Weekend' : holidayName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No lateness entries can be recorded on {isWeekend ? 'weekends.' : 'public holidays.'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Date and Save Action */}
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => changeSelectedDate(addDays(selectedDate, -1))}
                aria-label="Previous date"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={selectedDateKey}
                onChange={(event) => handleDateInputChange(event.target.value)}
                className="h-10 w-[168px]"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => changeSelectedDate(addDays(selectedDate, 1))}
                aria-label="Next date"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => changeSelectedDate(parseISO(getAccraDateKey()))}
              className="self-start"
            >
              Today
            </Button>
            <span className="text-sm text-muted-foreground">
              {format(selectedDate, 'EEEE,')} <span className="font-medium">{format(selectedDate, 'MMMM d, yyyy')}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              aria-label="Refresh lateness entries"
              disabled={saving}
              onClick={() => {
                setMessage(null);
                void fetchStaffAndEntries();
              }}
              size="icon"
              title="Refresh lateness entries"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleSaveAll} disabled={saving || entriesDisabled}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : entriesDisabled ? 'Closed - No Entries' : 'Save Lateness Entries'}
            </Button>
          </div>
        </div>

        {/* Entry Grid */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-card">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="w-44 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</th>
                  <th className="w-28 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</th>
                  <th className="w-24 px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">No Sign Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry, index) => {
                  const member = staff.find((s) => s.id === entry.staffId);
                  return (
                    <tr key={entry.staffId} className="hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <span>{member?.fullName}</span>
                          {member?.archived && (
                            <span className="rounded-full border border-warning/25 px-2 py-0.5 text-[11px] font-medium text-warning">
                              Former
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <TimeSelector
                          value={entry.arrivalTime}
                          onChange={(value) => updateEntry(entry.staffId, 'arrivalTime', value)}
                          disabled={entriesDisabled}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {entry.amount > 0 ? (
                          <span className="text-danger">GHC {entry.amount}</span>
                        ) : entry.isGeneralPardon ? (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-semibold text-success">General pardon</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {entry.reason || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Checkbox
                          checked={entry.didNotSignOut}
                          onCheckedChange={(checked) =>
                            updateEntry(entry.staffId, 'didNotSignOut', checked === true)
                          }
                          disabled={entriesDisabled}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Day Summary */}
        <Card>
          <div className="p-4">
            <h3 className="mb-3 font-semibold">Day Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-danger">{totals.late}</p>
                <p className="text-xs text-muted-foreground mt-1">Late</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-success">{totals.onTime}</p>
                <p className="text-xs text-muted-foreground mt-1">On Time</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-warning">{totals.didNotSignOut}</p>
                <p className="text-xs text-muted-foreground mt-1">No Sign Out</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono">GHC {totals.totalAmount}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Amount</p>
              </div>
            </div>
          </div>
        </Card>

      </div>
    </DashboardLayout>
  );
}

function TimeSelector({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openNativePicker() {
    const input = inputRef.current;
    if (!input || disabled) return;

    try {
      input.showPicker?.();
    } catch {
      input.focus();
      input.click();
    }
  }

  return (
    <div className="relative w-36">
      <Input
        ref={inputRef}
        aria-label="Arrival time"
        className="latewatch-native-time-input h-9 w-full pr-9 font-mono text-sm font-medium [color-scheme:light] dark:[color-scheme:dark]"
        disabled={disabled}
        max="18:00"
        min="06:00"
        step={300}
        type="time"
        value={normalizeTimeValue(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        aria-label="Open time picker"
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        type="button"
        onClick={openNativePicker}
      >
        <Clock className="h-4 w-4" />
      </button>
    </div>
  );
}
