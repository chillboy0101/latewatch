import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessPayment, latenessPaymentAllocation, staff } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const MAX_REASON_LENGTH = 300;

// Undo a payment recorded by mistake. The payment and the days it paid are released together
// (those days count as unpaid again), and the reason goes in the Audit Trail.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const { paymentId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
    if (!reason) {
      return NextResponse.json({ error: 'Say why this payment is being undone' }, { status: 400 });
    }

    const [payment] = await db.select().from(latenessPayment).where(eq(latenessPayment.id, paymentId)).limit(1);
    if (!payment) {
      return NextResponse.json({ error: 'This payment was not found (it may already have been undone)' }, { status: 404 });
    }
    const [allocations, [member]] = await Promise.all([
      db.select().from(latenessPaymentAllocation).where(eq(latenessPaymentAllocation.paymentId, payment.id)),
      db.select({ fullName: staff.fullName }).from(staff).where(eq(staff.id, payment.staffId)).limit(1),
    ]);

    // Allocations go with the payment (on delete cascade), in one statement.
    await db.delete(latenessPayment).where(eq(latenessPayment.id, payment.id));

    await writeAuditEvent({
      entityType: 'lateness_payment',
      entityId: payment.id,
      action: 'DELETE',
      before: { ...payment, allocations, staffName: member?.fullName || null },
      after: { reason, undone: true },
      reason: 'lateness-payment-undo',
    });

    publishRealtime('payments', 'invalidate', { reason: 'lateness-payment-undo', staffId: payment.staffId });
    publishRealtime('staff-penalty-history', 'invalidate', { reason: 'lateness-payment-undo', staffId: payment.staffId });
    publishRealtime('dashboard', 'invalidate', { reason: 'lateness-payment-undo' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'lateness-payment-undo' });
    publishRealtime('notifications', 'invalidate', { reason: 'lateness-payment-undo' });

    return NextResponse.json({ success: true, undoneAmount: payment.amount });
  } catch (error) {
    console.error('Failed to undo lateness payment:', error);
    return NextResponse.json({ error: 'Could not undo the payment' }, { status: 500 });
  }
}
