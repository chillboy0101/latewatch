'use client';

import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { StaffPicker } from '@/components/ui/staff-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccraDateKey } from '@/lib/date-key';
import { STAFF_LEAVE_TYPES } from '@/lib/staff-leave';
import { cn } from '@/lib/utils';

type LeavePeriod = {
  endDate: string | null;
  id: string;
  leaveType: string;
  returnedOn: string | null;
  staffId: string;
  startDate: string;
};

type StaffOption = { fullName: string; id: string };

type LeaveSaveResult = {
  financialReview?: { paidEntryCount?: number };
  replacedPermissionCount?: number;
  replacedPermissionDays?: string;
};

const selectClassName = 'h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-10 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-60';

function Select({ label, onChange, value, children }: { children: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="relative">
        <select aria-label={label} className={selectClassName} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

function displayDate(value: string) {
  return format(parseISO(value), 'd MMM yyyy');
}

function leaveTypeLabel(value: string) {
  return STAFF_LEAVE_TYPES.find((type) => type.value === value)?.label || 'Leave';
}

/**
 * One place to put staff on leave, change when the leave ends, or record their return.
 * Shows only what applies: a new-leave form when the person is not on leave, otherwise their
 * current leave with a choice between recording their return and changing the end date.
 */
export function StaffLeaveDialog({
  initialStaffId,
  onChanged,
  onOpenChange,
  open,
  staffOptions,
}: {
  initialStaffId?: string;
  onChanged?: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  staffOptions: StaffOption[];
}) {
  const today = getAccraDateKey();
  const [staffId, setStaffId] = useState(initialStaffId || '');
  const [periods, setPeriods] = useState<LeavePeriod[] | null>(null);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [leaveType, setLeaveType] = useState('annual');
  const [returnDate, setReturnDate] = useState(today);
  const [action, setAction] = useState<'return' | 'end'>('return');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const current = periods?.find((period) => period.staffId === staffId && !period.returnedOn) || null;
  const staffName = staffOptions.find((option) => option.id === staffId)?.fullName;

  const loadPeriods = useCallback(async () => {
    try {
      const response = await fetch('/api/attendance/leave', { cache: 'no-store' });
      const payload = await response.json().catch(() => []);
      setPeriods(Array.isArray(payload) ? payload : []);
    } catch {
      setPeriods([]);
    }
  }, []);

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStaffId(initialStaffId || '');
    setMessage(null);
    void loadPeriods();
  }, [initialStaffId, loadPeriods, open]);

  // Fill the form for whoever is selected.
  useEffect(() => {
    const key = getAccraDateKey();
    setStartDate(key);
    setEndDate(current?.endDate || key);
    setLeaveType('annual');
    setReturnDate(key);
    setAction('return');
  }, [staffId, current?.id, current?.endDate]);

  // Leave replaces any absence / late permissions already approved on its days; say so.
  function withReplaced(success: string) {
    return (body: LeaveSaveResult) => {
      const replaced = body.replacedPermissionCount
        ? ` It replaces the permission${body.replacedPermissionCount === 1 ? '' : 's'} on ${body.replacedPermissionDays}.`
        : '';
      // Leave entered after the fact clears unpaid charges on its days; paid ones stay paid.
      const paid = body.financialReview?.paidEntryCount
        ? ` ${body.financialReview.paidEntryCount} day${body.financialReview.paidEntryCount === 1 ? ' was' : 's were'} already paid and stay${body.financialReview.paidEntryCount === 1 ? 's' : ''} as paid.`
        : '';
      return `${success}${replaced}${paid}`;
    };
  }

  async function submit(request: () => Promise<Response>, success: string | ((body: LeaveSaveResult) => string)) {
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await request();
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save leave.');
      await loadPeriods();
      await onChanged?.();
      setMessage({ error: false, text: typeof success === 'string' ? success : success(body) });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Could not save leave.' });
    } finally {
      setSubmitting(false);
    }
  }

  function approveLeave() {
    if (!staffId) return setMessage({ error: true, text: 'Select a staff member.' });
    if (!startDate || !endDate || endDate < startDate) return setMessage({ error: true, text: 'The end date must be on or after the start date.' });
    void submit(() => fetch('/api/attendance/leave', {
      body: JSON.stringify({ endDate, leaveType, staffId, startDate }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }), withReplaced('Leave approved.'));
  }

  function changeEndDate() {
    if (!current) return;
    if (!endDate || endDate < current.startDate) return setMessage({ error: true, text: 'The end date must be on or after the start date.' });
    void submit(() => fetch(`/api/attendance/leave/${current.id}`, {
      body: JSON.stringify({ endDate }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }), withReplaced('End date updated.'));
  }

  function recordReturn() {
    if (!current) return;
    if (!returnDate || returnDate <= current.startDate || returnDate > today) {
      return setMessage({ error: true, text: 'Pick a return day after the start date and not in the future.' });
    }
    void submit(() => fetch(`/api/attendance/leave/${current.id}`, {
      body: JSON.stringify({ returnedOn: returnDate }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }), 'Return recorded.');
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-lg has-[[data-picker-open]]:overflow-visible">
        <DialogHeader>
          <DialogTitle>Staff leave</DialogTitle>
          <DialogDescription>
            {!staffName ? 'New leave' : periods === null ? 'Loading…' : current ? 'On leave' : 'Not on leave'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <StaffPicker
            className="sm:col-span-2"
            label="Staff"
            value={staffId}
            options={staffOptions}
            onChange={(value) => { setStaffId(value); setMessage(null); }}
          />

          {current ? (
            <>
              <div className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm text-primary sm:col-span-2">
                <span className="font-semibold">{leaveTypeLabel(current.leaveType)} leave</span>
                {' · '}
                {current.startDate > today ? 'starts' : 'since'} {displayDate(current.startDate)}
                {' · '}
                {current.endDate ? `ends ${displayDate(current.endDate)}` : 'no end date'}
              </div>
              <div role="tablist" aria-label="Leave action" className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1 sm:col-span-2">
                {([['return', 'Returned'], ['end', 'Change end date']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={action === value}
                    onClick={() => { setAction(value); setMessage(null); }}
                    className={cn(
                      'h-9 rounded text-sm font-medium transition-colors',
                      action === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {action === 'return' ? (
                <DateField className="sm:col-span-2" label="Back at work on" value={returnDate} onChange={setReturnDate} />
              ) : (
                <DateField className="sm:col-span-2" label="New end date" value={endDate} onChange={setEndDate} />
              )}
            </>
          ) : (
            <>
              <DateField label="From" value={startDate} onChange={setStartDate} />
              <DateField label="To" value={endDate} onChange={setEndDate} />
              <div className="sm:col-span-2">
                <Select label="Type" value={leaveType} onChange={setLeaveType}>
                  {STAFF_LEAVE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {message && (
            <p className={cn('text-sm font-medium sm:col-span-2', message.error ? 'text-danger' : 'text-primary')}>{message.text}</p>
          )}
        </div>

        <DialogFooter>
          {current ? (
            action === 'return' ? (
              <Button onClick={recordReturn} disabled={submitting || !returnDate}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record return
              </Button>
            ) : (
              <Button onClick={changeEndDate} disabled={submitting || !endDate || endDate === current.endDate}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save end date
              </Button>
            )
          ) : (
            <Button onClick={approveLeave} disabled={submitting || !staffId || periods === null}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve leave
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
