import type { ReceiptDetailData } from '@/components/receipts/receipt-detail-view';
import { formatDisplayDate, formatDisplayDateTime, formatLongDisplayDate } from '@/lib/date-format';
import { getLatenessPaymentReceiptDocumentTitle } from '@/lib/lateness-payment-receipts';

function ghc(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

let logoDataUrlPromise: Promise<string | null> | null = null;

// Load the LateWatch logo once and cache it as a data URL for embedding.
function getLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlPromise) return logoDataUrlPromise;

  logoDataUrlPromise = (async () => {
    try {
      const response = await fetch('/latewatch-logo.png', { cache: 'force-cache' });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();

  return logoDataUrlPromise;
}

export function getReceiptPdfFileName(detail: ReceiptDetailData) {
  const title = getLatenessPaymentReceiptDocumentTitle(detail.receipt.receiptNumber, detail.receipt.recordedAt);
  return `${title.replace(/[^\w.-]+/g, '-')}.pdf`;
}

/**
 * Builds the payment receipt as a PDF Blob (jsPDF + autotable, lazy-loaded) so it
 * can be shared via the Web Share sheet (iOS: Print / Save to Files) or downloaded
 * — no page navigation required.
 */
export async function buildReceiptPdfBlob(detail: ReceiptDetailData): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  let y = 54;

  const logo = await getLogoDataUrl();

  // Centered faint logo watermark for authenticity (drawn first, behind content).
  if (logo) {
    try {
      const size = 340;
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.06 }));
      doc.addImage(logo, 'PNG', (pageWidth - size) / 2, (pageHeight - size) / 2, size, size);
      doc.restoreGraphicsState();
    } catch {
      // Ignore watermark failures; the receipt still renders.
    }
  }

  const titleX = logo ? marginX + 34 : marginX;
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', marginX, y - 20, 26, 26);
    } catch {
      // Ignore header logo failures.
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('LateWatch', titleX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text('Attendance payment receipt', titleX, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text('OFFICIAL RECEIPT', pageWidth - marginX, y - 4, { align: 'right' });
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(detail.receipt.receiptNumber, pageWidth - marginX, y + 12, { align: 'right' });

  y += 40;
  doc.setDrawColor(220);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 22;

  const fields: Array<[string, string]> = [
    ['Receipt No', detail.receipt.receiptNumber],
    ['Amount paid', ghc(detail.receipt.amount)],
    ['Staff', detail.staff.fullName],
    ['Staff email', detail.staff.email || '-'],
    ['Payment date', formatDisplayDateTime(detail.receipt.recordedAt)],
    ['Recorded by', detail.receipt.recordedByEmail || '-'],
    ['Penalty week', `${formatDisplayDate(detail.receipt.weekStart)} to ${formatDisplayDate(detail.receipt.weekEnd)}`],
    ['Note', detail.receipt.note || '-'],
  ];

  const colWidth = (pageWidth - marginX * 2) / 2;
  doc.setFontSize(9);
  fields.forEach(([label, value], index) => {
    const col = index % 2;
    const x = marginX + col * colWidth;
    if (col === 0 && index > 0) y += 40;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30);
    doc.text(doc.splitTextToSize(value, colWidth - 12), x, y + 14);
  });

  y += 40;

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [['Day / Date', 'Reason', 'Penalty', 'Paid']],
    body: detail.allocations.length > 0
      ? detail.allocations.map((allocation) => [
          `${formatLongDisplayDate(allocation.date)}${allocation.arrivalTime ? `\n${allocation.arrivalTime.slice(0, 5)}` : ''}`,
          allocation.reason || 'Late arrival',
          ghc(allocation.penaltyAmount),
          ghc(allocation.allocatedAmount),
        ])
      : [['No allocated penalty days found for this receipt.', '', '', '']],
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 6 },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
  });

  return doc.output('blob');
}
