'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReceiptDetailView, useReceiptDetail } from '@/components/receipts/receipt-detail-view';

export default function PaymentReceiptPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = typeof params.paymentId === 'string' ? params.paymentId : '';
  const { receipt, loading, error, documentTitle } = useReceiptDetail(paymentId);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = documentTitle;

    return () => {
      document.title = previousTitle;
    };
  }, [documentTitle]);

  function handlePrint() {
    document.title = documentTitle;
    // iOS installed PWAs (standalone) silently ignore window.print(); open the
    // receipt in Safari where print / Save-PDF works. Everything else prints inline.
    const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (iosStandalone) {
      window.open(window.location.href, '_blank');
      return;
    }
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
          <Link href="/check-in?receipts=1">
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

      <div className="mx-auto flex max-w-3xl flex-col">
        <ReceiptDetailView receipt={receipt} loading={loading} error={error} />
      </div>
    </main>
  );
}
