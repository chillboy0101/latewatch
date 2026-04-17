'use client';

import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';

interface Holiday {
  id: string;
  date: string;
  isHoliday: boolean;
  holidayNote: string | null;
  source: 'google' | 'manual';
  isRemoved: boolean;
}

export default function CalendarPage() {
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayNote, setNewHolidayNote] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [addMessage, setAddMessage] = useState('');

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
    } else {
      setAddMessage('Failed to add holiday');
    }

    setTimeout(() => setAddMessage(''), 3000);
  };

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

        {/* Add Custom Holiday */}
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-sm mb-3">Add Custom Holiday</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="holiday-name">Name</Label>
                <Input id="holiday-name" placeholder="e.g. Local Festival" value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="holiday-date">Date</Label>
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
              {addMessage && <span className="text-xs font-medium text-emerald-500">{addMessage}</span>}
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}