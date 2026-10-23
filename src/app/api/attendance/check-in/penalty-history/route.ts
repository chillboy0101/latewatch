import { currentUser } from '@clerk/nextjs/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessDebtPardonEntry, latenessEntry, latenessPayment, latenessPaymentAllocation } from '@/db/schema';
import { getAccraClock } from '@/lib/attendance';
import { getSignedInStaff } from '@/lib/auth/signed-in-staff';
import { summarizeLatenessPaymentReceipts } from '@/lib/lateness-payment-receipts';
import { summarizeLatenessPaymentEntries, summarizePenaltyHistoryWeeks } from '@/lib/lateness-payments';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const member = await getSignedInStaff(user);

    if (!member) {
      return NextResponse.json({ error: 'Staff profile was not found' }, { status: 404 });
    }

    const clock = getAccraClock();

    const entries = await db.select()
      .from(latenessEntry)
      .where(eq(latenessEntry.staffId, member.id))
      .orderBy(desc(latenessEntry.date));
    const penaltyEntries = entries.filter((entry) => Number(entry.computedAmount || 0) > 0);
    const allocations = penaltyEntries.length === 0
      ? []
      : await db.select()
        .from(latenessPaymentAllocation)
        .where(inArray(latenessPaymentAllocation.entryId, penaltyEntries.map((entry) => entry.id)));
    const pardonRows = penaltyEntries.length === 0
      ? []
      : await db.select({
        entryId: latenessDebtPardonEntry.entryId,
        forgivenAmount: latenessDebtPardonEntry.forgivenAmount,
      })
        .from(latenessDebtPardonEntry)
        .where(inArray(latenessDebtPardonEntry.entryId, penaltyEntries.map((entry) => entry.id)));
    const pardonsByEntryId = new Map(pardonRows.map((pardon) => [pardon.entryId, pardon.forgivenAmount]));
    const entrySummaries = summarizeLatenessPaymentEntries({
      allocations,
      entries: penaltyEntries.map((entry) => {
        const forgivenAmount = pardonsByEntryId.get(entry.id);
        return forgivenAmount == null
          ? entry
          : { ...entry, pardonedAmount: forgivenAmount };
      }),
    });
    const payments = await db.select()
      .from(latenessPayment)
      .where(eq(latenessPayment.staffId, member.id))
      .orderBy(desc(latenessPayment.recordedAt));
    const receipts = summarizeLatenessPaymentReceipts(payments);
    const history = summarizePenaltyHistoryWeeks({
      currentDate: clock.dateKey,
      entries: entrySummaries,
      receipts,
    });

    return NextResponse.json({
      currentWeek: history.currentWeek,
      receipts,
      staff: {
        email: member.email,
        fullName: member.fullName,
        id: member.id,
      },
      weeks: history.weeks,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load penalty history:', error);
    return NextResponse.json({ error: 'Failed to load penalty history' }, { status: 500 });
  }
}
