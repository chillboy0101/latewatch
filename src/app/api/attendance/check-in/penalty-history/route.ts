import { currentUser } from '@clerk/nextjs/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPaymentAllocation } from '@/db/schema';
import { getAccraClock, getOrAutoLinkStaffByEmail } from '@/lib/attendance';
import { summarizeLatenessPaymentEntries, summarizePenaltyHistoryWeeks } from '@/lib/lateness-payments';

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

async function resolveMemberForPenaltyHistory(input: {
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

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const member = await resolveMemberForPenaltyHistory({
      candidateEmails: getUserEmailAddresses(user),
      fullName: getUserFullName(user),
    });

    if (!member) {
      return NextResponse.json({ error: 'Staff profile was not found' }, { status: 404 });
    }

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
    const entrySummaries = summarizeLatenessPaymentEntries({
      allocations,
      entries: penaltyEntries,
    });
    const history = summarizePenaltyHistoryWeeks({
      currentDate: getAccraClock().dateKey,
      entries: entrySummaries,
    });

    return NextResponse.json({
      currentWeek: history.currentWeek,
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
