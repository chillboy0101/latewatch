'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { format } from 'date-fns';
import { Save, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface StaffMember {
  id: string;
  fullName: string;
}

interface Entry {
  staffId: string;
  arrivalTime: string;
  didNotSignOut: boolean;
  amount: number;
  reason: string;
}

function computePenalty(
  arrivalTime: string | null,
  didNotSignOut: boolean
): { amount: number; reason: string } {
  const CUTOFF_TIME = '08:30';
  const BASE_PENALTY = 10;
  const HOURLY_INCREMENT = 5;
  const SIGN_OUT_PENALTY = 2;

  if (!arrivalTime) {
    if (didNotSignOut) {
      return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
    }
    return { amount: 0, reason: '' };
  }

  const isLate = arrivalTime > CUTOFF_TIME;

  if (!isLate && didNotSignOut) {
    return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
  }

  if (isLate) {
    const [hours, minutes] = arrivalTime.split(':').map(Number);
    const arrivalMinutes = hours * 60 + minutes;
    const cutoffMinutes = 8 * 60 + 30;
    const minutesLate = arrivalMinutes - cutoffMinutes;
    const fullHoursLate = Math.floor(minutesLate / 60);
    const hourly = HOURLY_INCREMENT * fullHoursLate;

    let reason = "DIDN'T COME BEFORE 8:30AM";
    let total = BASE_PENALTY + hourly;

    if (didNotSignOut) {
      total += SIGN_OUT_PENALTY;
      reason = "DIDN'T COME BEFORE 8:30AM AND DID NOT SIGN OUT";
    }

    return { amount: total, reason };
  }

  return { amount: 0, reason: '' };
}

export default function EntriesPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedDate] = useState(new Date());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStaffAndEntries = useCallback(async () => {
    try {
      const today = format(selectedDate, 'yyyy-MM-dd');

      // Fetch all data in parallel
      const [staffResponse, calendarResponse, entriesResponse] = await Promise.all([
        fetch('/api/staff'),
        fetch(`/api/calendar?start=${today}&end=${today}`),
        fetch(`/api/entries?date=${today}`),
      ]);

      const [staffData, calendarData, entriesData] = await Promise.all([
        staffResponse.json(),
        calendarResponse.json(),
        entriesResponse.json(),
      ]);

      const staffList = Array.isArray(staffData) ? staffData : [];
      setStaff(staffList);

      const holiday = Array.isArray(calendarData) ? calendarData.find((h: any) => h.isHoliday && !h.isRemoved) : null;
      setIsHoliday(!!holiday);
      setHolidayName(holiday?.holidayNote || 'Holiday');

      const entriesList = Array.isArray(entriesData) ? entriesData : [];

      const mergedEntries = staffList.map((s: StaffMember) => {
        const existing = entriesList.find((e: any) => e.staffId === s.id);
        return {
          staffId: s.id,
          arrivalTime: existing?.arrivalTime || '',
          didNotSignOut: existing?.didNotSignOut || false,
          amount: existing ? parseFloat(existing.computedAmount || '0') : 0,
          reason: existing?.reason || '',
        };
      });

      setEntries(mergedEntries);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaffAndEntries();
  }, [fetchStaffAndEntries, selectedDate]);

  
  const updateEntry = (staffId: string, field: keyof Entry, value: any) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId === staffId) {
          const updated = { ...entry, [field]: value };
          const penalty = computePenalty(
            updated.arrivalTime || null,
            updated.didNotSignOut
          );
          return {
            ...updated,
            amount: penalty.amount,
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
        setMessage({ type: 'success', text: `${data.count || entries.length} entries saved successfully` });
        // Re-fetch fresh data from DB so saved entries display immediately
        setTimeout(() => fetchStaffAndEntries(), 50);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || 'Failed to save entries' });
      }
    } catch (error) {
      console.error('Failed to save entries:', error);
      setMessage({ type: 'error', text: 'Failed to save entries' });
    } finally {
      setSaving(false);
      // Auto-dismiss message after 5 seconds
      setTimeout(() => setMessage(null), 5000);
    }
  }

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
      <DashboardLayout title="Daily Entry">
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading entries...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (staff.length === 0) {
    return (
      <DashboardLayout title="Daily Entry">
        <div className="space-y-6">
          <Card>
            <div className="p-8 text-center">
              <p className="text-lg mb-2">No staff members found</p>
              <p className="text-sm text-muted-foreground mb-4">Please add staff members first before recording entries</p>
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
    <DashboardLayout title="Daily Entry">
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
        {isHoliday && (
          <Card className="bg-warning/10 border-warning">
            <div className="flex items-center gap-3 p-4">
              <span className="text-2xl">🎉</span>
              <div>
                <p className="font-medium text-warning">This is a holiday</p>
                <p className="text-sm text-muted-foreground">{holidayName} - No entries can be recorded on holidays</p>
              </div>
            </div>
          </Card>
        )}

        {/* Date Display */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {format(selectedDate, 'EEEE,')} <span className="font-medium">{format(selectedDate, 'MMMM d, yyyy')}</span>
          </span>
        </div>

        {/* Entry Grid */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-card">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="w-32 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</th>
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
                      <td className="px-4 py-3 text-sm font-medium">{member?.fullName}</td>
                      <td className="px-4 py-3">
                        <Input
                          type="text"
                          placeholder="HH:MM"
                          value={entry.arrivalTime}
                          onChange={(e) =>
                            updateEntry(entry.staffId, 'arrivalTime', e.target.value)
                          }
                          className="h-8 w-24 font-mono"
                          maxLength={5}
                          disabled={isHoliday}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {entry.amount > 0 ? (
                          <span className="text-danger">GHC {entry.amount}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {entry.reason || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Checkbox
                          checked={entry.didNotSignOut}
                          onCheckedChange={(checked) =>
                            updateEntry(entry.staffId, 'didNotSignOut', checked)
                          }
                          disabled={isHoliday}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex justify-end">
          <Button onClick={handleSaveAll} disabled={saving || isHoliday}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : isHoliday ? 'Holiday — No Entries' : 'Save Entries'}
          </Button>
        </div>

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