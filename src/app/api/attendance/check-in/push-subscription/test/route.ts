import { currentUser } from '@clerk/nextjs/server';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { db } from '@/db';
import { pushSubscription } from '@/db/schema';
import { getOrAutoLinkStaffByEmail } from '@/lib/attendance';
import { ensureVapidConfig, hasVapidConfig, isExpiredPushEndpoint } from '@/lib/push-reminders';

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

async function resolveStaffForPushTest() {
  const user = await currentUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), staffMember: null, user: null };
  }

  const emails = getUserEmailAddresses(user);
  const email = emails[0] || null;
  if (!email) {
    return { error: NextResponse.json({ error: 'Signed-in email is required' }, { status: 400 }), staffMember: null, user };
  }

  for (const candidateEmail of emails) {
    const resolved = await getOrAutoLinkStaffByEmail({
      email: candidateEmail,
      fullName: getUserFullName(user),
    });

    if (resolved.member) {
      return { error: null, staffMember: resolved.member, user };
    }
  }

  return { error: NextResponse.json({ error: 'Active staff profile required' }, { status: 404 }), staffMember: null, user };
}

export async function POST() {
  const summary = {
    configured: hasVapidConfig(),
    disabled: 0,
    failed: 0,
    sent: 0,
  };

  const resolved = await resolveStaffForPushTest();
  if (resolved.error) return resolved.error;

  if (!ensureVapidConfig()) {
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const subscriptions = await db.select({
    auth: pushSubscription.auth,
    endpoint: pushSubscription.endpoint,
    id: pushSubscription.id,
    p256dh: pushSubscription.p256dh,
  })
    .from(pushSubscription)
    .where(and(
      eq(pushSubscription.staffId, resolved.staffMember.id),
      eq(pushSubscription.userId, resolved.user.id),
      isNull(pushSubscription.disabledAt),
    ));

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          auth: subscription.auth,
          p256dh: subscription.p256dh,
        },
      }, JSON.stringify({
        body: 'Your LateWatch reminder notifications are working on this device.',
        data: {
          reminderType: 'test',
          url: '/check-in',
        },
        icon: '/latewatch-logo.png',
        tag: 'latewatch-reminder-test',
        title: 'LateWatch test reminder',
      }));

      summary.sent += 1;
    } catch (error) {
      if (isExpiredPushEndpoint(error)) {
        await db.update(pushSubscription)
          .set({
            disabledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pushSubscription.id, subscription.id));
        summary.disabled += 1;
      }

      summary.failed += 1;
    }
  }

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
