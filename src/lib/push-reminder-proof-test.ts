import 'server-only';

import { and, eq, isNull, or } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '@/db';
import { pushReminderDelivery, pushSubscription, staff } from '@/db/schema';
import { getAccraClock } from '@/lib/attendance';
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
    staffId: pushSubscription.staffId,
  })
    .from(pushSubscription)
    .innerJoin(staff, eq(pushSubscription.staffId, staff.id))
    .where(and(
      isNull(pushSubscription.disabledAt),
      or(eq(pushSubscription.signInEnabled, true), eq(pushSubscription.signOutEnabled, true)),
      eq(staff.active, true),
      eq(staff.archived, false),
    ));

  summary.totalSubscriptions = subscriptionRows.length;

  if (!ensureVapidConfig()) {
    return summary;
  }

  const date = getAccraClock().dateKey;

  for (const subscription of subscriptionRows) {
    const [delivery] = await db.insert(pushReminderDelivery)
      .values({
        date,
        reminderType: testId,
        staffId: subscription.staffId,
        status: 'pending',
        subscriptionId: subscription.id,
      })
      .onConflictDoNothing({
        target: [
          pushReminderDelivery.subscriptionId,
          pushReminderDelivery.date,
          pushReminderDelivery.reminderType,
        ],
      })
      .returning();

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
          deliveryId: delivery?.id,
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

      if (delivery) {
        await db.update(pushReminderDelivery)
          .set({
            sentAt: new Date(),
            status: 'sent',
          })
          .where(eq(pushReminderDelivery.id, delivery.id));
      }
      summary.sent += 1;
    } catch (error) {
      const expiredEndpoint = isExpiredPushEndpoint(error);
      if (expiredEndpoint) {
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

      if (delivery) {
        await db.update(pushReminderDelivery)
          .set({
            error: error instanceof Error ? error.message.slice(0, 500) : 'Push send failed',
            status: expiredEndpoint ? 'disabled' : 'failed',
          })
          .where(eq(pushReminderDelivery.id, delivery.id));
      }
      summary.failed += 1;
    }
  }

  return summary;
}
