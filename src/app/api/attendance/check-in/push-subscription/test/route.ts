import { currentUser } from '@clerk/nextjs/server';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { db } from '@/db';
import { pushSubscription } from '@/db/schema';
import { findStaffForEmails, verifiedEmailAddresses } from '@/lib/auth/signed-in-staff';
import { ensureVapidConfig, hasVapidConfig, isExpiredPushEndpoint } from '@/lib/push-reminders';
import { allowRequest } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const PUSH_TEST_LIMIT = 3;
const PUSH_TEST_WINDOW_SECONDS = 3600;

async function resolveStaffForPushTest() {
  const user = await currentUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), staffMember: null, user: null };
  }

  const emails = verifiedEmailAddresses(user);
  if (emails.length === 0) {
    return { error: NextResponse.json({ error: 'A verified email is required' }, { status: 400 }), staffMember: null, user };
  }

  const staffMember = await findStaffForEmails(emails);
  if (staffMember) return { error: null, staffMember, user };

  return { error: NextResponse.json({ error: 'Active staff profile required' }, { status: 404 }), staffMember: null, user };
}

export async function POST() {
  const summary = {
    configured: hasVapidConfig(),
    disabled: 0,
    failed: 0,
    sent: 0,
  };

  try {
    const resolved = await resolveStaffForPushTest();
    if (resolved.error) return resolved.error;

    // Each call sends a real push, so cap how often one signed-in user can fire them.
    const gate = await allowRequest(`push-test:${resolved.user.id}`, PUSH_TEST_LIMIT, PUSH_TEST_WINDOW_SECONDS);
    if (!gate.allowed) {
      return NextResponse.json({
        ...summary,
        error: 'Too many test notifications. Try again in a few minutes.',
        retryAfterSeconds: gate.retryAfterSeconds,
      }, {
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(gate.retryAfterSeconds),
        },
        status: 429,
      });
    }

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
  } catch {
    return NextResponse.json({
      ...summary,
      error: 'Push test failed. Check the reminder push service configuration.',
    }, {
      headers: { 'Cache-Control': 'no-store' },
      status: 500,
    });
  }
}
