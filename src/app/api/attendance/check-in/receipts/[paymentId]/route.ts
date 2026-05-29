import { currentUser } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPayment, latenessPaymentAllocation } from '@/db/schema';
import { getOrAutoLinkStaffByEmail } from '@/lib/attendance';
import { buildLatenessPaymentReceiptDetail } from '@/lib/lateness-payment-receipts';

export const dynamic = 'force-dynamic';

function getUserFullName(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  return user.fullName
    || [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || null;
}

function getUserEmailAddresses(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const emails = [
    user.primaryEmailAddress?.emailAddress,
    ...user.emailAddresses.map((emailAddress) => emailAddress.emailAddress),
  ]
    .map((email) => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  return Array.from(new Set(emails));
}

async function resolveMemberForReceipt(input: {
  candidateEmails: string[];
  fullName: string | null;
}) {
  for (const email of input.candidateEmails) {
    const resolved = await getOrAutoLinkStaffByEmail({
      email,
      fullName: input.fullName,
    });

    if (resolved.member) return resolved.member;
  }

  return null;
}

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
    const member = await resolveMemberForReceipt({
      candidateEmails: getUserEmailAddresses(user),
      fullName: getUserFullName(user),
    });

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
