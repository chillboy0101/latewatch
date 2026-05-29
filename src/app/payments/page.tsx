'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plus, ReceiptText, Save, Search, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { formatDisplayDate } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type PaymentStatus = 'paid' | 'partially_paid' | 'unpaid';
type StaffPaymentStatus = 'paid' | 'unpaid';
type PaymentFilter = 'all' | StaffPaymentStatus;

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

interface OffenceBookStoredItem {
  amount: string;
  displayOrder: number;
  id: string;
  itemType: 'external_money' | 'expenditure';
  label: string;
  monthKey: string;
}

interface OffenceBookItemsResponse {
  expenditure: OffenceBookStoredItem[];
  externalMoney: OffenceBookStoredItem[];
  month: number;
  monthKey: string;
  openingBalance: string;
  year: number;
}

interface OffenceBookDraftItem {
  amount: string;
  clientId: string;
  label: string;
}

const paymentFilterOptions: Array<{ label: string; value: PaymentFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Unpaid', value: 'unpaid' },
  { label: 'Paid', value: 'paid' },
];

const offenceBookLimits = {
  expenditure: 9,
  externalMoney: 4,
};

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

function createOffenceBookDraftItem(): OffenceBookDraftItem {
  return {
    amount: '',
    clientId: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: '',
  };
}

function offenceBookDraftsFromRows(rows: OffenceBookStoredItem[]) {
  const drafts = rows
    .slice()
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((row) => ({
      amount: row.amount || '',
      clientId: row.id,
      label: row.label || '',
    }));

  return drafts.length > 0 ? drafts : [createOffenceBookDraftItem()];
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

function staffPaymentStatusForRow(row: PaymentStaffRow): StaffPaymentStatus {
  return moneyNumber(row.outstandingBalance) > 0 ? 'unpaid' : 'paid';
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

function sortPaymentEntriesNewestFirst(entries: PaymentEntry[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const dateDifference = right.entry.date.localeCompare(left.entry.date);
      if (dateDifference !== 0) return dateDifference;

      const timeDifference = (right.entry.arrivalTime || '').localeCompare(left.entry.arrivalTime || '');
      return timeDifference !== 0 ? timeDifference : left.index - right.index;
    })
    .map(({ entry }) => entry);
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
  const [offenceBookMonth, setOffenceBookMonth] = useState(new Date().getMonth());
  const [offenceBookYear, setOffenceBookYear] = useState(new Date().getFullYear());
  const [offenceBookLoading, setOffenceBookLoading] = useState(true);
  const [offenceBookSaving, setOffenceBookSaving] = useState(false);
  const [offenceBookMessage, setOffenceBookMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [openingBalance, setOpeningBalance] = useState('');
  const [externalMoneyDrafts, setExternalMoneyDrafts] = useState<OffenceBookDraftItem[]>(() => [createOffenceBookDraftItem()]);
  const [expenditureDrafts, setExpenditureDrafts] = useState<OffenceBookDraftItem[]>(() => [createOffenceBookDraftItem()]);

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

  const loadOffenceBookItems = useCallback(async () => {
    setOffenceBookLoading(true);
    setOffenceBookMessage(null);

    try {
      const response = await fetch(`/api/payments/offence-book-items?year=${offenceBookYear}&month=${offenceBookMonth}`, {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as Partial<OffenceBookItemsResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || `Offence book request failed (${response.status})`);

      setExternalMoneyDrafts(offenceBookDraftsFromRows(body.externalMoney || []));
      setExpenditureDrafts(offenceBookDraftsFromRows(body.expenditure || []));
      setOpeningBalance(body.openingBalance || '');
    } catch (error) {
      console.error('Failed to load offence book inputs:', error);
      setOpeningBalance('');
      setExternalMoneyDrafts([createOffenceBookDraftItem()]);
      setExpenditureDrafts([createOffenceBookDraftItem()]);
      setOffenceBookMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load offence book inputs' });
    } finally {
      setOffenceBookLoading(false);
    }
  }, [offenceBookMonth, offenceBookYear]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    void loadOffenceBookItems();
  }, [loadOffenceBookItems]);

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
              void loadOffenceBookItems();
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
  }, [loadOffenceBookItems, loadPayments]);

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
      : searchedRows.filter((row) => staffPaymentStatusForRow(row) === statusFilter);
  }, [data?.staff, search, statusFilter]);
  const filteredRows = useMemo(() => sortPaymentRowsByBalance(matchingRows), [matchingRows]);
  const paymentTotals = useMemo(() => {
    const rows = (data?.staff || []).filter((row) => row.isAttendanceOnly !== true);

    return rows.reduce(
      (totals, row) => ({
        paidAmount: totals.paidAmount + moneyNumber(row.paidAmount),
        unpaidAmount: totals.unpaidAmount + moneyNumber(row.outstandingBalance),
      }),
      { paidAmount: 0, unpaidAmount: 0 },
    );
  }, [data?.staff]);
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
  const selectedEntries = useMemo(() => {
    return selectedRow ? sortPaymentEntriesNewestFirst(selectedRow.entries) : [];
  }, [selectedRow]);

  function openPaymentDialog(row: PaymentStaffRow) {
    setSelectedStaffId(row.id);
    setAmount('');
    setNote('');
    setPaymentDialogOpen(true);
  }

  function updateOffenceBookDraft(
    list: 'externalMoney' | 'expenditure',
    clientId: string,
    field: 'amount' | 'label',
    value: string,
  ) {
    const setter = list === 'externalMoney' ? setExternalMoneyDrafts : setExpenditureDrafts;
    setter((current) => current.map((item) => (
      item.clientId === clientId
        ? { ...item, [field]: field === 'amount' ? normalizePaymentAmountInput(value) : value }
        : item
    )));
  }

  function addOffenceBookDraft(list: 'externalMoney' | 'expenditure') {
    const limit = list === 'externalMoney' ? offenceBookLimits.externalMoney : offenceBookLimits.expenditure;
    const setter = list === 'externalMoney' ? setExternalMoneyDrafts : setExpenditureDrafts;
    setter((current) => current.length >= limit ? current : [...current, createOffenceBookDraftItem()]);
  }

  function removeOffenceBookDraft(list: 'externalMoney' | 'expenditure', clientId: string) {
    const setter = list === 'externalMoney' ? setExternalMoneyDrafts : setExpenditureDrafts;
    setter((current) => {
      const next = current.filter((item) => item.clientId !== clientId);
      return next.length > 0 ? next : [createOffenceBookDraftItem()];
    });
  }

  async function saveOffenceBookItems() {
    if (offenceBookSaving) return;

    setOffenceBookSaving(true);
    setOffenceBookMessage(null);

    try {
      const response = await fetch('/api/payments/offence-book-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenditure: expenditureDrafts.map(({ amount, label }) => ({ amount, label })),
          externalMoney: externalMoneyDrafts.map(({ amount, label }) => ({ amount, label })),
          month: offenceBookMonth,
          openingBalance,
          year: offenceBookYear,
        }),
      });
      const body = await response.json().catch(() => ({})) as Partial<OffenceBookItemsResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || `Offence book save failed (${response.status})`);

      setExternalMoneyDrafts(offenceBookDraftsFromRows(body.externalMoney || []));
      setExpenditureDrafts(offenceBookDraftsFromRows(body.expenditure || []));
      setOpeningBalance(body.openingBalance || '');
      setOffenceBookMessage({ type: 'success', text: 'Offence book inputs saved.' });
    } catch (error) {
      console.error('Offence book save failed:', error);
      setOffenceBookMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save offence book inputs' });
    } finally {
      setOffenceBookSaving(false);
    }
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
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h2 className="text-base font-semibold">Offence book inputs</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Month</label>
                    <select
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={offenceBookMonth}
                      onChange={(event) => setOffenceBookMonth(parseInt(event.target.value, 10))}
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index} value={index}>
                          {new Date(offenceBookYear, index, 1).toLocaleString(undefined, { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Year</label>
                    <select
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={offenceBookYear}
                      onChange={(event) => setOffenceBookYear(parseInt(event.target.value, 10))}
                    >
                      {Array.from({ length: 11 }, (_, index) => {
                        const year = 2024 + index;
                        return (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">Opening Balance</label>
                    <Input
                      value={openingBalance}
                      onChange={(event) => setOpeningBalance(normalizePaymentAmountInput(event.target.value))}
                      placeholder="0.00"
                      inputMode="decimal"
                      disabled={offenceBookLoading || offenceBookSaving}
                    />
                  </div>
                </div>
              </div>
              <Button
                type="button"
                className="h-10 gap-2"
                disabled={offenceBookLoading || offenceBookSaving}
                onClick={saveOffenceBookItems}
              >
                {offenceBookSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save inputs
              </Button>
            </div>
          </div>

          <div className="grid gap-px bg-border lg:grid-cols-2">
            <OffenceBookInputSection
              addLabel="Add source"
              amountLabel="Amount"
              disabled={offenceBookLoading || offenceBookSaving}
              label="External Money"
              labelPlaceholder="Source"
              limit={offenceBookLimits.externalMoney}
              rows={externalMoneyDrafts}
              onAdd={() => addOffenceBookDraft('externalMoney')}
              onRemove={(clientId) => removeOffenceBookDraft('externalMoney', clientId)}
              onUpdate={(clientId, field, value) => updateOffenceBookDraft('externalMoney', clientId, field, value)}
            />
            <OffenceBookInputSection
              addLabel="Add item"
              amountLabel="Amount"
              disabled={offenceBookLoading || offenceBookSaving}
              label="Expenditure"
              labelPlaceholder="Item"
              limit={offenceBookLimits.expenditure}
              rows={expenditureDrafts}
              onAdd={() => addOffenceBookDraft('expenditure')}
              onRemove={(clientId) => removeOffenceBookDraft('expenditure', clientId)}
              onUpdate={(clientId, field, value) => updateOffenceBookDraft('expenditure', clientId, field, value)}
            />
          </div>

          {offenceBookMessage && (
            <div className={cn(
              'border-t border-border px-4 py-2 text-sm',
              offenceBookMessage.type === 'success' ? 'text-success' : 'text-danger',
            )}>
              {offenceBookMessage.text}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="grid gap-3 lg:grid-cols-[auto_1fr_minmax(240px,24rem)] lg:items-center">
              <div className="flex w-full rounded-md border border-border bg-background p-1 md:w-auto">
                {paymentFilterOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={statusFilter === option.value ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 flex-1 md:flex-none"
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-center">
                <PaymentToolbarTotal label="Paid" value={currency(paymentTotals.paidAmount)} tone="paid" />
                <PaymentToolbarTotal label="Unpaid" value={currency(paymentTotals.unpaidAmount)} tone="unpaid" />
              </div>
              <div className="relative w-full md:max-w-sm">
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
                            <StaffPaymentStatusBadge status={staffPaymentStatusForRow(row)} />
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
                      {selectedEntries.map((entry) => (
                        <div key={entry.entryId} className="rounded-md border border-border px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium">
                                {formatDisplayDate(entry.date)}
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
                      {selectedEntries.length === 0 && (
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

function PaymentToolbarTotal({ label, tone, value }: { label: string; tone: 'paid' | 'unpaid'; value: string }) {
  return (
    <div className={cn(
      'flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm',
      tone === 'paid' ? 'border-success/20' : 'border-warning/25',
    )}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn(
        'font-mono font-semibold',
        tone === 'paid' ? 'text-success' : 'text-warning',
      )}>
        {value}
      </span>
    </div>
  );
}

function StaffPaymentStatusBadge({ status }: { status: StaffPaymentStatus }) {
  return (
    <span className={cn(
      'inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-medium',
      status === 'paid' && 'border-success/25 bg-success/10 text-success',
      status === 'unpaid' && 'border-danger/25 bg-danger/10 text-danger',
    )}>
      {status === 'paid' ? 'Paid' : 'Unpaid'}
    </span>
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

function OffenceBookInputSection({
  addLabel,
  amountLabel,
  disabled,
  label,
  labelPlaceholder,
  limit,
  rows,
  onAdd,
  onRemove,
  onUpdate,
}: {
  addLabel: string;
  amountLabel: string;
  disabled: boolean;
  label: string;
  labelPlaceholder: string;
  limit: number;
  rows: OffenceBookDraftItem[];
  onAdd: () => void;
  onRemove: (clientId: string) => void;
  onUpdate: (clientId: string, field: 'amount' | 'label', value: string) => void;
}) {
  return (
    <div className="bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={disabled || rows.length >= limit}
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.clientId} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input
              value={row.label}
              onChange={(event) => onUpdate(row.clientId, 'label', event.target.value)}
              placeholder={labelPlaceholder}
              disabled={disabled}
            />
            <Input
              value={row.amount}
              onChange={(event) => onUpdate(row.clientId, 'amount', event.target.value)}
              placeholder={amountLabel}
              inputMode="decimal"
              disabled={disabled}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 text-danger"
              disabled={disabled}
              title="Remove row"
              aria-label="Remove row"
              onClick={() => onRemove(row.clientId)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
