import { currentUser } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPayment, latenessPaymentAllocation } from '@/db/schema';
import { getSignedInStaff } from '@/lib/auth/signed-in-staff';
import { buildLatenessPaymentReceiptDetail } from '@/lib/lateness-payment-receipts';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { paymentId } = await params;
    const member = await getSignedInStaff(user);

    if (!member || !paymentId) {
      return NextResponse.json({ error: 'Receipt was not found' }, { status: 404 });
    }

    const [payment] = await db.select()
      .from(latenessPayment)
      .where(and(
        eq(latenessPayment.id, paymentId),
        eq(latenessPayment.staffId, member.id),
      ))
      .limit(1);

    if (!payment) {
      return NextResponse.json({ error: 'Receipt was not found' }, { status: 404 });
    }

    const allocations = await db.select()
      .from(latenessPaymentAllocation)
      .where(eq(latenessPaymentAllocation.paymentId, payment.id));
    const entryIds = allocations.map((allocation) => allocation.entryId);
    const entries = entryIds.length === 0
      ? []
      : await db.select()
        .from(latenessEntry)
        .where(inArray(latenessEntry.id, entryIds));

    return NextResponse.json(
      buildLatenessPaymentReceiptDetail({
        allocations,
        entries,
        payment,
        staff: member,
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to load payment receipt:', error);
    return NextResponse.json({ error: 'Failed to load payment receipt' }, { status: 500 });
  }
}
