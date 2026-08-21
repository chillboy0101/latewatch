'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMediumDisplayDate, isIsoDateKey } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { getLeaveEndDateForReturn, getLeaveResumeDate } from '@/lib/attendance-permissions';

export interface EndLeaveTarget {
  endDate: string | null;
  id: string;
  leaveType?: string | null;
  staffName: string;
  startDate: string;
}

export function EndLeaveDialog({
  leave,
  onCompleted,
  onOpenChange,
}: {
  leave: EndLeaveTarget | null;
  onCompleted: (message: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [returnedOn, setReturnedOn] = useState(getAccraDateKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!leave) return;
    setReturnedOn(getAccraDateKey());
    setError('');
  }, [leave]);

  const finalLeaveDate = useMemo(
    () => (isIsoDateKey(returnedOn) ? getLeaveEndDateForReturn(returnedOn) : null),
    [returnedOn],
  );
  const currentResumeDate = leave?.endDate ? getLeaveResumeDate(leave.endDate) : null;
  const invalidReturn = Boolean(
    leave && (
      !isIsoDateKey(returnedOn) ||
      returnedOn <= leave.startDate ||
      (currentResumeDate && returnedOn > currentResumeDate)
    ),
  );

  async function submit() {
    if (!leave || invalidReturn) return;
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/api/attendance/permissions/${leave.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnedOn }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Could not end this leave');
        return;
      }

      onOpenChange(false);
      await onCompleted(
        `${leave.staffName} returns on ${formatMediumDisplayDate(returnedOn)}. ${formatMediumDisplayDate(finalLeaveDate)} is the final leave day.`,
      );
    } catch (submitError) {
      console.error('Failed to end leave:', submitError);
      setError('Could not end this leave. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(leave)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End Leave</DialogTitle>
          <DialogDescription>
            Choose the first day {leave?.staffName || 'this staff member'} is expected back at work.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <DateField label="First day back" value={returnedOn} onChange={setReturnedOn} disabled={saving} />
          {leave && returnedOn && returnedOn <= leave.startDate && (
            <p className="text-sm text-danger">The first day back must be after the leave start date.</p>
          )}
          {currentResumeDate && returnedOn > currentResumeDate && (
            <p className="text-sm text-danger">
              End Leave can shorten this leave, but cannot extend it beyond {formatMediumDisplayDate(currentResumeDate)}. Use Change to extend the range.
            </p>
          )}
          {finalLeaveDate && !invalidReturn && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              Final leave day: <span className="font-medium text-foreground">{formatMediumDisplayDate(finalLeaveDate)}</span>
              {' · '}
              Attendance resumes: <span className="font-medium text-foreground">{formatMediumDisplayDate(returnedOn)}</span>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="gap-2" onClick={submit} disabled={!leave || invalidReturn || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck2 className="h-4 w-4" />}
            Confirm Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
