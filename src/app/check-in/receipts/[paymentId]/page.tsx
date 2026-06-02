'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { formatDisplayDate, formatDisplayDateTime, formatLongDisplayDate } from '@/lib/date-format';
import { getLatenessPaymentReceiptDocumentTitle } from '@/lib/lateness-payment-receipts';

type ReceiptDetail = {
  allocations: Array<{
    allocatedAmount: string;
    arrivalTime: string | null;
    date: string;
    entryId: string;
    penaltyAmount: string;
    reason: string | null;
  }>;
  receipt: {
    amount: string;
    note: string | null;
    paymentId: string;
    receiptNumber: string;
    recordedAt: string | null;
    recordedByEmail: string | null;
    weekEnd: string;
    weekStart: string;
  };
  staff: {
    email: string | null;
    fullName: string;
    id: string;
  };
};

function ghc(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

function ReceiptField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

export default function PaymentReceiptPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = typeof params.paymentId === 'string' ? params.paymentId : '';
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const receiptUrl = useMemo(() => `/api/attendance/check-in/receipts/${paymentId}`, [paymentId]);
  const receiptDocumentTitle = useMemo(() => {
    if (!receipt) return 'LateWatch Receipt';
    return getLatenessPaymentReceiptDocumentTitle(receipt.receipt.receiptNumber, receipt.receipt.recordedAt);
  }, [receipt]);

  useEffect(() => {
    let cancelled = false;

    async function loadReceipt() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(receiptUrl, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Receipt request failed (${response.status})`);
        if (!cancelled) setReceipt(body);
      } catch (requestError) {
        if (!cancelled) {
          setReceipt(null);
          setError(requestError instanceof Error ? requestError.message : 'Could not load receipt');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (paymentId) {
      void loadReceipt();
    } else {
      setLoading(false);
      setError('Receipt was not found');
    }

    return () => {
      cancelled = true;
    };
  }, [paymentId, receiptUrl]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = receiptDocumentTitle;

    return () => {
      document.title = previousTitle;
    };
  }, [receiptDocumentTitle]);

  function handlePrint() {
    document.title = receiptDocumentTitle;
    window.print();
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #ffffff !important; }
          main { padding: 0 !important; background: #ffffff !important; }
          .receipt-sheet { border: 0 !important; box-shadow: none !important; max-width: none !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/check-in">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <Button
          type="button"
          className="gap-2"
          onClick={handlePrint}
          disabled={!receipt || loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          Print / Save PDF
        </Button>
      </div>

      {loading ? (
        <div className="mx-auto max-w-3xl">
          <LoadingBuffer variant="section" label="Loading receipt" description="Checking payment details." />
        </div>
      ) : error ? (
        <Card className="mx-auto max-w-3xl p-6 text-center">
          <h1 className="text-lg font-semibold">Receipt unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </Card>
      ) : receipt ? (
        <Card className="receipt-sheet mx-auto max-w-3xl overflow-hidden bg-card">
          <section className="border-b border-border p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <LateWatchLogo subtitle="Attendance payment receipt" />
              <div className="text-left sm:text-right">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Official Receipt</div>
                <div className="mt-1 font-mono text-lg font-bold">{receipt.receipt.receiptNumber}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 border-b border-border p-6 sm:grid-cols-2">
            <ReceiptField label="Receipt No" value={receipt.receipt.receiptNumber} />
            <ReceiptField label="Amount paid" value={ghc(receipt.receipt.amount)} />
            <ReceiptField label="Staff" value={receipt.staff.fullName} />
            <ReceiptField label="Staff email" value={receipt.staff.email || '-'} />
            <ReceiptField label="Payment date" value={formatDisplayDateTime(receipt.receipt.recordedAt)} />
            <ReceiptField label="Recorded by" value={receipt.receipt.recordedByEmail || '-'} />
            <ReceiptField
              label="Penalty week"
              value={`${formatDisplayDate(receipt.receipt.weekStart)} to ${formatDisplayDate(receipt.receipt.weekEnd)}`}
            />
            <ReceiptField label="Note" value={receipt.receipt.note || '-'} />
          </section>

          <section className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Allocated penalty days</h2>
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Day / Date</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 text-right font-medium">Penalty</th>
                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {receipt.allocations.map((allocation) => (
                    <tr key={`${allocation.entryId}-${allocation.allocatedAmount}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{formatLongDisplayDate(allocation.date)}</div>
                        <div className="text-xs text-muted-foreground">{allocation.arrivalTime?.slice(0, 5) || '-'}</div>
                      </td>
                      <td className="px-3 py-2">{allocation.reason || 'Late arrival'}</td>
                      <td className="px-3 py-2 text-right font-mono">{ghc(allocation.penaltyAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{ghc(allocation.allocatedAmount)}</td>
                    </tr>
                  ))}
                  {receipt.allocations.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>
                        No allocated penalty days found for this receipt.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </Card>
      ) : null}
    </main>
  );
}
