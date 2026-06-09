import 'server-only';

import { and, eq, isNull, or } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '@/db';
import { pushSubscription, staff } from '@/db/schema';
import { ensureVapidConfig, hasVapidConfig, isExpiredPushEndpoint } from '@/lib/push-reminders';

export async function sendReminderProofTestBatch(testId = `proof-${Date.now()}`) {
  const summary = {
    configured: hasVapidConfig(),
    disabled: 0,
    failed: 0,
    sent: 0,
    testId,
    totalSubscriptions: 0,
  };

  const subscriptionRows = await db.select({
    auth: pushSubscription.auth,
    endpoint: pushSubscription.endpoint,
    id: pushSubscription.id,
    p256dh: pushSubscription.p256dh,
  })
    .from(pushSubscription)
    .innerJoin(staff, eq(pushSubscription.staffId, staff.id))
    .where(and(
      isNull(pushSubscription.disabledAt),
      or(eq(pushSubscription.signInEnabled, true), eq(pushSubscription.signOutEnabled, true)),
      eq(staff.active, true),
      eq(staff.archived, false),
      eq(staff.isAttendanceOnly, false),
    ));

  summary.totalSubscriptions = subscriptionRows.length;

  if (!ensureVapidConfig()) {
    return summary;
  }

  for (const subscription of subscriptionRows) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          auth: subscription.auth,
          p256dh: subscription.p256dh,
        },
      }, JSON.stringify({
        body: 'This is a scheduled LateWatch reminder test for all enabled notification devices.',
        data: {
          reminderType: 'proof_test',
          testId,
          url: '/check-in',
        },
        icon: '/latewatch-logo.png',
        renotify: true,
        requireInteraction: true,
        tag: `latewatch-reminder-proof-test-${testId}`,
        title: 'LateWatch scheduled test reminder',
      }), {
        TTL: 15 * 60,
      });

      summary.sent += 1;
    } catch (error) {
      if (isExpiredPushEndpoint(error)) {
        await db.update(pushSubscription)
          .set({
            disabledAt: new Date(),
            signInEnabled: false,
            signOutEnabled: false,
            updatedAt: new Date(),
          })
          .where(eq(pushSubscription.id, subscription.id));
        summary.disabled += 1;
      }

      summary.failed += 1;
    }
  }

  return summary;
}
