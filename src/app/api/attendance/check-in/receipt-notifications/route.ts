import { currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessPayment, notificationRead } from '@/db/schema';
import { getOrAutoLinkStaffByEmail } from '@/lib/attendance';
import {
  buildLatenessPaymentReceiptNotifications,
  getLatenessPaymentReceiptNotificationId,
} from '@/lib/lateness-payment-receipt-notifications';

export const dynamic = 'force-dynamic';

const DISMISSED_PREFIX = 'dismissed:';
const RECEIPT_NOTIFICATION_LIMIT = 10;

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

async function resolveMemberForReceiptNotifications(input: {
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
      return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 401 });
    }

    const member = await resolveMemberForReceiptNotifications({
      candidateEmails: getUserEmailAddresses(user),
      fullName: getUserFullName(user),
    });

    if (!member) {
      return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 404 });
    }

    const payments = await db.select()
      .from(latenessPayment)
      .where(eq(latenessPayment.staffId, member.id))
      .orderBy(desc(latenessPayment.recordedAt))
      .limit(RECEIPT_NOTIFICATION_LIMIT);
    const notifications = buildLatenessPaymentReceiptNotifications(payments);
    const notificationIds = notifications.flatMap((notification) => [
      notification.id,
      `${DISMISSED_PREFIX}${notification.id}`,
    ]);
    const stateRows = notificationIds.length === 0
      ? []
      : await db.select({ notificationId: notificationRead.notificationId })
        .from(notificationRead)
        .where(and(
          eq(notificationRead.userId, user.id),
          inArray(notificationRead.notificationId, notificationIds),
        ));
    const hiddenIds = new Set<string>();

    for (const row of stateRows) {
      if (row.notificationId.startsWith(DISMISSED_PREFIX)) {
        hiddenIds.add(row.notificationId.slice(DISMISSED_PREFIX.length));
      } else {
        hiddenIds.add(row.notificationId);
      }
    }

    const unseen = notifications.filter((notification) => (
      !hiddenIds.has(getLatenessPaymentReceiptNotificationId(notification.paymentId))
    ));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      notifications: unseen,
      unreadCount: unseen.length,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load receipt notifications:', error);
    return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 500 });
  }
}
