// app/entries/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { format, startOfWeek, addDays } from 'date-fns';
import { Save, Calendar as CalendarIcon } from 'lucide-react';

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

  useEffect(() => {
    fetchStaffAndEntries();
  }, []);

  async function fetchStaffAndEntries() {
    try {
      // Fetch staff
      const staffResponse = await fetch('/api/staff');
      const staffData = await staffResponse.json();
      const staffList = Array.isArray(staffData) ? staffData : [];
      setStaff(staffList);
      
      // Initialize entries
      const today = format(selectedDate, 'yyyy-MM-dd');
      const entriesResponse = await fetch(`/api/entries?date=${today}`);
      const entriesData = await entriesResponse.json();
      const entriesList = Array.isArray(entriesData) ? entriesData : [];
      
      // Merge staff with entries
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
  }

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
        alert('Entries saved successfully!');
      } else {
        alert('Failed to save entries');
      }
    } catch (error) {
      console.error('Failed to save entries:', error);
      alert('Failed to save entries');
    } finally {
      setSaving(false);
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
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading...
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
              <p className="text-lg mb-2">📝</p>
              <p className="text-muted-foreground">No staff members found</p>
              <p className="text-sm mt-2">Please add staff members first before recording entries</p>
              <Button className="mt-4" onClick={() => window.location.href = '/staff'}>
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
        {/* Date Selector */}
        <div className="flex items-center gap-4">
          <Button variant="outline" className="gap-2">
            <CalendarIcon className="h-4 w-4" />
            {format(selectedDate, 'MMMM yyyy')}
          </Button>
          <Button variant="outline">
            Week: {format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'MMM dd')} -{' '}
            {format(addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), 4), 'MMM dd')}
          </Button>
          <Button variant="outline">
            Day: {format(selectedDate, 'EEE dd')}
          </Button>
        </div>

        {/* Entry Grid */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-card">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-sm font-medium text-muted-foreground">#</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Name</th>
                  <th className="w-32 px-4 py-3 text-left text-sm font-medium text-muted-foreground">Time</th>
                  <th className="w-28 px-4 py-3 text-left text-sm font-medium text-muted-foreground">Amount</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Reason</th>
                  <th className="w-24 px-4 py-3 text-center text-sm font-medium text-muted-foreground">No Sign Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry, index) => {
                  const member = staff.find((s) => s.id === entry.staffId);
                  return (
                    <tr key={entry.staffId} className="hover:bg-card/50">
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
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {entry.amount > 0 ? `GHC ${entry.amount}` : '—'}
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
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Tips */}
        <Card className="bg-warning/10">
          <div className="p-4 text-sm">
            <strong>💡 Tips:</strong>
            <ul className="mt-2 list-inside space-y-1 text-muted-foreground">
              <li>• Leave TIME blank for staff who arrived on time</li>
              <li>• Check "Did not sign out" to add GHC 2 penalty</li>
              <li>• Reason auto-generates based on time + sign-out status</li>
            </ul>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button variant="outline">
            <Save className="mr-2 h-4 w-4" />
            Save Draft
          </Button>
          <Button onClick={handleSaveAll} disabled={saving}>
            {saving ? 'Saving...' : 'Submit All Entries'}
          </Button>
        </div>

        {/* Day Summary */}
        <Card>
          <div className="p-4">
            <h3 className="mb-3 font-semibold">📊 Day Summary</h3>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Total Late:</span>{' '}
                <span className="font-mono font-medium text-danger">{totals.late}</span>
              </div>
              <div>
                <span className="text-muted-foreground">On Time:</span>{' '}
                <span className="font-mono font-medium text-success">{totals.onTime}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Did Not Sign Out:</span>{' '}
                <span className="font-mono font-medium text-warning">{totals.didNotSignOut}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Amount:</span>{' '}
                <span className="font-mono font-medium">GHC {totals.totalAmount}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
