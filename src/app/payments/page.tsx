'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { CalendarDays, CheckCircle2, Loader2, ReceiptText, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { cn } from '@/lib/utils';

type PaymentStatus = 'paid' | 'partially_paid' | 'unpaid';

interface PaymentEntry {
  arrivalTime: string | null;
  date: string;
  entryId: string;
  outstandingAmount: string;
  paidAmount: string;
  penaltyAmount: string;
  reason: string | null;
  status: PaymentStatus;
}

interface PaymentStaffRow {
  email: string | null;
  entries: PaymentEntry[];
  fullName: string;
  id: string;
  isAttendanceOnly: boolean | null;
  isNssPersonnel: boolean | null;
  outstandingBalance: string;
  paidAmount: string;
  totalPenalty: string;
}

interface PaymentsResponse {
  staff: PaymentStaffRow[];
  weekEnd: string;
  weekStart: string;
}

function currentWeekStart() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function weekEndFor(weekStart: string) {
  return format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd');
}

function currency(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

function moneyNumber(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function statusLabel(status: PaymentStatus) {
  if (status === 'paid') return 'Paid';
  if (status === 'partially_paid') return 'Partially paid';
  return 'Unpaid';
}

function staffKind(row: PaymentStaffRow) {
  if (row.isAttendanceOnly) return 'Monitoring only';
  if (row.isNssPersonnel) return 'NSS Personnel';
  return 'Main Staff';
}

export default function PenaltyPaymentsPage() {
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const weekEnd = useMemo(() => weekEndFor(weekStart), [weekStart]);
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/payments/lateness?weekStart=${weekStart}&weekEnd=${weekEnd}`, {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Payments request failed (${response.status})`);
      setData(body);
    } catch (error) {
      console.error('Failed to load lateness payments:', error);
      setData(null);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load payments' });
    } finally {
      setLoading(false);
    }
  }, [weekEnd, weekStart]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = data?.staff || [];
    if (!query) return rows;

    return rows.filter((row) => [
      row.fullName,
      row.email || '',
      staffKind(row),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [data?.staff, search]);

  const selectedRow = useMemo(() => {
    return filteredRows.find((row) => row.id === selectedStaffId)
      || filteredRows.find((row) => moneyNumber(row.outstandingBalance) > 0)
      || filteredRows[0]
      || null;
  }, [filteredRows, selectedStaffId]);

  useEffect(() => {
    if (selectedRow && selectedRow.id !== selectedStaffId) {
      setSelectedStaffId(selectedRow.id);
    }
  }, [selectedRow, selectedStaffId]);

  async function recordPayment(input: {
    actionKey: string;
    amount: number;
    entryId?: string;
    note?: string | null;
  }) {
    if (!selectedRow || input.amount <= 0) return;

    setSavingAction(input.actionKey);
    setMessage(null);

    try {
      const response = await fetch('/api/payments/lateness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: input.amount,
          entryId: input.entryId,
          note: input.note,
          staffId: selectedRow.id,
          weekEnd,
          weekStart,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Payment failed (${response.status})`);

      setAmount('');
      setNote('');
      setMessage({ type: 'success', text: 'Payment recorded.' });
      await loadPayments();
    } catch (error) {
      console.error('Payment recording failed:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Payment could not be recorded' });
    } finally {
      setSavingAction(null);
    }
  }

  const manualAmount = moneyNumber(amount);

  return (
    <DashboardLayout title="Penalty Payments">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Penalty Payments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Record full or partial lateness payments and keep staff balances transparent.
            </p>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium uppercase text-muted-foreground" htmlFor="payment-week-start">
              Week start
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="payment-week-start"
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value || currentWeekStart())}
                className="h-10 w-44"
              />
              <span className="text-sm text-muted-foreground">to {weekEnd}</span>
            </div>
          </div>
        </div>

        {message && (
          <div className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            message.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger',
          )}>
            {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <ReceiptText className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Weekly balances</h2>
                  <p className="text-sm text-muted-foreground">
                    {weekStart} to {weekEnd}
                  </p>
                </div>
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search staff or email"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <LoadingBuffer variant="section" label="Loading payments" description="Checking weekly balances." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium">Roster</th>
                      <th className="px-4 py-3 text-right font-medium">Owed</th>
                      <th className="px-4 py-3 text-right font-medium">Paid</th>
                      <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const active = selectedRow?.id === row.id;
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'cursor-pointer border-b border-border transition-colors hover:bg-muted/20',
                            active && 'bg-primary/5',
                          )}
                          onClick={() => setSelectedStaffId(row.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.fullName}</div>
                            <div className="text-xs text-muted-foreground">{row.email || 'No email'}</div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{staffKind(row)}</td>
                          <td className="px-4 py-3 text-right font-mono">{currency(row.totalPenalty)}</td>
                          <td className="px-4 py-3 text-right font-mono">{currency(row.paidAmount)}</td>
                          <td className={cn(
                            'px-4 py-3 text-right font-mono font-semibold',
                            moneyNumber(row.outstandingBalance) > 0 ? 'text-warning' : 'text-success',
                          )}>
                            {currency(row.outstandingBalance)}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                          No staff balances found for this week.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="self-start overflow-hidden">
            <div className="border-b border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selectedRow?.fullName || 'Select staff'}</h2>
                  <p className="text-sm text-muted-foreground">{selectedRow ? staffKind(selectedRow) : 'Choose a row to manage payments'}</p>
                </div>
              </div>
            </div>

            {selectedRow ? (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-3 gap-2">
                  <BalanceStat label="Owed" value={currency(selectedRow.totalPenalty)} />
                  <BalanceStat label="Paid" value={currency(selectedRow.paidAmount)} />
                  <BalanceStat label="Outstanding" value={currency(selectedRow.outstandingBalance)} highlight />
                </div>

                <div className="rounded-md border border-border">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    Late days
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {selectedRow.entries.map((entry) => (
                      <div key={entry.entryId} className="border-b border-border px-3 py-3 last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{entry.date}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {entry.arrivalTime?.slice(0, 5) || '-'} - {entry.reason || 'Late arrival'}
                            </div>
                          </div>
                          <PaymentStatusBadge status={entry.status} />
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <MiniAmount label="Penalty" value={currency(entry.penaltyAmount)} />
                          <MiniAmount label="Paid" value={currency(entry.paidAmount)} />
                          <MiniAmount label="Balance" value={currency(entry.outstandingAmount)} />
                        </div>
                        {moneyNumber(entry.outstandingAmount) > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full gap-2"
                            disabled={Boolean(savingAction)}
                            onClick={() => recordPayment({
                              actionKey: `day-${entry.entryId}`,
                              amount: moneyNumber(entry.outstandingAmount),
                              entryId: entry.entryId,
                              note: 'Marked day paid',
                            })}
                          >
                            {savingAction === `day-${entry.entryId}` && <Loader2 className="h-4 w-4 animate-spin" />}
                            Mark day paid
                          </Button>
                        )}
                      </div>
                    ))}
                    {selectedRow.entries.length === 0 && (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No penalty days for this week.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border p-3">
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground" htmlFor="payment-amount">
                      Amount
                    </label>
                    <Input
                      id="payment-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0.00"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground" htmlFor="payment-note">
                      Note
                    </label>
                    <Input
                      id="payment-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Optional payment note"
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(savingAction) || moneyNumber(selectedRow.outstandingBalance) <= 0}
                      onClick={() => recordPayment({
                        actionKey: 'week',
                        amount: moneyNumber(selectedRow.outstandingBalance),
                        note: 'Marked week paid',
                      })}
                    >
                      {savingAction === 'week' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Mark week paid
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(savingAction) || manualAmount <= 0}
                      onClick={() => recordPayment({
                        actionKey: 'manual',
                        amount: manualAmount,
                        note,
                      })}
                    >
                      {savingAction === 'manual' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Record payment
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">Select a staff member to view penalty days.</div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function BalanceStat({ highlight, label, value }: { highlight?: boolean; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-sm font-semibold', highlight && 'text-warning')}>{value}</div>
    </div>
  );
}

function MiniAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/20 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono font-semibold">{value}</div>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={cn(
      'inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium',
      status === 'paid' && 'border-success/25 bg-success/10 text-success',
      status === 'partially_paid' && 'border-warning/25 bg-warning/10 text-warning',
      status === 'unpaid' && 'border-danger/25 bg-danger/10 text-danger',
    )}>
      {statusLabel(status)}
    </span>
  );
}
