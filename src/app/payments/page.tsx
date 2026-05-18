'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, ReceiptText, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type PaymentStatus = 'paid' | 'partially_paid' | 'unpaid';
type PaymentFilter = 'all' | PaymentStatus;

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
  scope: 'all' | 'week';
  staff: PaymentStaffRow[];
}

const paymentFilterOptions: Array<{ label: string; value: PaymentFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Unpaid', value: 'unpaid' },
  { label: 'Partial', value: 'partially_paid' },
  { label: 'Paid', value: 'paid' },
];

function currency(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

function moneyNumber(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizePaymentAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...decimalParts] = cleaned.split('.');

  if (decimalParts.length === 0) return whole;

  return `${whole}.${decimalParts.join('').slice(0, 2)}`;
}

function statusLabel(status: PaymentStatus) {
  if (status === 'paid') return 'Paid';
  if (status === 'partially_paid') return 'Partially paid';
  return 'Unpaid';
}

function staffKind(row: PaymentStaffRow) {
  if (row.isNssPersonnel) return 'NSS Personnel';
  return 'Main Staff';
}

function paymentStatusForRow(row: PaymentStaffRow): PaymentStatus {
  const totalPenalty = moneyNumber(row.totalPenalty);
  const paidAmount = moneyNumber(row.paidAmount);
  const outstandingBalance = moneyNumber(row.outstandingBalance);

  if (totalPenalty <= 0 || outstandingBalance <= 0) return 'paid';
  if (paidAmount > 0) return 'partially_paid';
  return 'unpaid';
}

function compactPenaltyLine(entry: PaymentEntry) {
  return `${currency(entry.penaltyAmount)} | paid ${currency(entry.paidAmount)} | bal ${currency(entry.outstandingAmount)}`;
}

function sortPaymentRowsByBalance(rows: PaymentStaffRow[]) {
  return rows
    .map((row, index) => ({ index, row }))
    .sort((left, right) => {
      const balanceDifference = moneyNumber(right.row.outstandingBalance) - moneyNumber(left.row.outstandingBalance);
      if (balanceDifference !== 0) return balanceDifference;

      const penaltyDifference = moneyNumber(right.row.totalPenalty) - moneyNumber(left.row.totalPenalty);
      return penaltyDifference !== 0 ? penaltyDifference : left.index - right.index;
    })
    .map(({ row }) => row);
}

export default function PenaltyPaymentsPage() {
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaymentFilter>('all');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/payments/lateness', {
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
  }, []);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['payments', 'entries', 'attendance'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: () => {
              void loadPayments();
            },
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
  }, [loadPayments]);

  const matchingRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = (data?.staff || []).filter((row) => row.isAttendanceOnly !== true);
    const searchedRows = query
      ? rows.filter((row) => [
        row.fullName,
        row.email || '',
        staffKind(row),
      ].some((value) => value.toLowerCase().includes(query)))
      : rows;

    return statusFilter === 'all'
      ? searchedRows
      : searchedRows.filter((row) => paymentStatusForRow(row) === statusFilter);
  }, [data?.staff, search, statusFilter]);
  const filteredRows = useMemo(() => sortPaymentRowsByBalance(matchingRows), [matchingRows]);
  const paymentRosterSections = useMemo(() => {
    return [
      {
        rows: filteredRows.filter((row) => row.isNssPersonnel !== true),
        title: 'Main Staff',
      },
      {
        rows: filteredRows.filter((row) => row.isNssPersonnel === true),
        title: 'NSS Personnel',
      },
    ].filter((section) => section.rows.length > 0);
  }, [filteredRows]);

  const selectedRow = useMemo(() => {
    return (data?.staff || []).find((row) => row.id === selectedStaffId && row.isAttendanceOnly !== true) || null;
  }, [data?.staff, selectedStaffId]);

  function openPaymentDialog(row: PaymentStaffRow) {
    setSelectedStaffId(row.id);
    setAmount('');
    setNote('');
    setPaymentDialogOpen(true);
  }

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
    <DashboardLayout title="Payments">
      <div className="space-y-5">
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

        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Payment balances</h2>
                <p className="text-sm text-muted-foreground">All penalty records</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-md border border-border bg-background p-1">
                  {paymentFilterOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={statusFilter === option.value ? 'default' : 'ghost'}
                      size="sm"
                      className="h-8"
                      onClick={() => setStatusFilter(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="relative w-full min-w-64 sm:w-80">
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
          </div>

          {loading ? (
            <LoadingBuffer variant="section" label="Loading payments" description="Checking balances." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Staff</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentRosterSections.map((section) => (
                    <Fragment key={section.title}>
                      <tr className="border-b border-border bg-muted/10">
                        <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={4}>
                          {section.title}
                          <span className="ml-2 rounded-full bg-background px-2 py-0.5 font-normal normal-case tracking-normal">
                            {section.rows.length}
                          </span>
                        </td>
                      </tr>
                      {section.rows.map((row) => (
                        <tr
                          key={row.id}
                          className="cursor-pointer border-b border-border transition-colors hover:bg-muted/20"
                          onClick={() => openPaymentDialog(row)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.fullName}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{row.email || 'No email'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <PaymentStatusBadge status={paymentStatusForRow(row)} />
                          </td>
                          <td className={cn(
                            'px-4 py-3 text-right font-mono font-semibold',
                            moneyNumber(row.outstandingBalance) > 0 ? 'text-warning' : 'text-success',
                          )}>
                            {currency(row.outstandingBalance)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                openPaymentDialog(row);
                              }}
                            >
                              Manage
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                        No staff balances found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-xl overflow-hidden p-0">
            {selectedRow ? (
              <div className="flex max-h-[86dvh] flex-col">
                <DialogHeader className="border-b border-border px-5 py-4 pr-10">
                  <DialogTitle className="text-base">{selectedRow.fullName}</DialogTitle>
                  <DialogDescription className="sr-only">
                    Manage lateness payments for the selected staff member.
                  </DialogDescription>
                  <div className="text-xs text-muted-foreground">{staffKind(selectedRow)}</div>
                </DialogHeader>

                <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-background">
                  <BalanceStat label="Owed" value={currency(selectedRow.totalPenalty)} />
                  <BalanceStat label="Paid" value={currency(selectedRow.paidAmount)} />
                  <BalanceStat label="Balance" value={currency(selectedRow.outstandingBalance)} highlight />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                  <div className="space-y-2">
                      {selectedRow.entries.map((entry) => (
                        <div key={entry.entryId} className="rounded-md border border-border px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium">
                                {entry.date}
                                <span className="ml-2 font-normal text-muted-foreground">
                                  {entry.arrivalTime?.slice(0, 5) || '-'}
                                </span>
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {entry.reason || 'Late arrival'}
                              </div>
                            </div>
                            <PaymentStatusBadge status={entry.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className={cn(
                              'font-mono',
                              moneyNumber(entry.outstandingAmount) > 0 ? 'text-warning' : 'text-success',
                            )}>
                              {compactPenaltyLine(entry)}
                            </span>
                            {moneyNumber(entry.outstandingAmount) > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 px-2"
                                disabled={Boolean(savingAction)}
                                onClick={() => recordPayment({
                                  actionKey: `day-${entry.entryId}`,
                                  amount: moneyNumber(entry.outstandingAmount),
                                  entryId: entry.entryId,
                                  note: 'Marked day paid',
                                })}
                              >
                                {savingAction === `day-${entry.entryId}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Mark as paid
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {selectedRow.entries.length === 0 && (
                        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                          No penalty days found.
                        </div>
                      )}
                  </div>
                </div>

                <div className="space-y-3 border-t border-border bg-background p-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      id="payment-amount"
                      aria-label="Payment amount"
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      value={amount}
                      onChange={(event) => setAmount(normalizePaymentAmountInput(event.target.value))}
                      placeholder="Amount paid"
                    />
                    <Input
                      id="payment-note"
                      aria-label="Note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Note"
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
                        note: 'Marked balance paid',
                      })}
                      title="Pay the full outstanding balance"
                    >
                      {savingAction === 'week' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Pay full balance
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(savingAction) || manualAmount <= 0}
                      onClick={() => recordPayment({
                        actionKey: 'manual',
                        amount: manualAmount,
                        note,
                      })}
                      title="Record the amount typed above"
                    >
                      {savingAction === 'manual' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Record amount
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <DialogHeader>
                <DialogTitle>Payment details</DialogTitle>
                <DialogDescription>Select a staff member from the table.</DialogDescription>
              </DialogHeader>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function BalanceStat({ highlight, label, value }: { highlight?: boolean; label: string; value: string }) {
  return (
    <div className="min-w-0 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-sm font-semibold', highlight && 'text-warning')}>{value}</div>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={cn(
      'inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-medium',
      status === 'paid' && 'border-success/25 bg-success/10 text-success',
      status === 'partially_paid' && 'border-warning/25 bg-warning/10 text-warning',
      status === 'unpaid' && 'border-danger/25 bg-danger/10 text-danger',
    )}>
      {statusLabel(status)}
    </span>
  );
}
