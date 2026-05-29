import 'server-only';

import { and, eq, isNull, or } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '@/db';
import { pushSubscription } from '@/db/schema';
import {
  buildLatenessPaymentReceiptPushPayload,
  type LatenessPaymentReceiptNotificationPaymentLike,
} from '@/lib/lateness-payment-receipt-notifications';

let vapidConfigured = false;

function hasVapidConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
    && process.env.VAPID_SUBJECT,
  );
}

function ensureVapidConfig() {
  if (!hasVapidConfig()) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
      process.env.VAPID_PRIVATE_KEY || '',
    );
    vapidConfigured = true;
  }
  return true;
}

function isExpiredPushEndpoint(error: unknown) {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;

  return statusCode === 404 || statusCode === 410;
}

export async function sendLatenessPaymentReceiptPush(
  payment: LatenessPaymentReceiptNotificationPaymentLike & { staffId: string },
) {
  const summary = {
    configured: hasVapidConfig(),
    disabled: 0,
    failed: 0,
    paymentId: payment.id,
    sent: 0,
    skipped: 0,
  };

  if (!ensureVapidConfig()) return summary;

  const subscriptions = await db.select({
    auth: pushSubscription.auth,
    endpoint: pushSubscription.endpoint,
    id: pushSubscription.id,
    p256dh: pushSubscription.p256dh,
  })
    .from(pushSubscription)
    .where(and(
      eq(pushSubscription.staffId, payment.staffId),
      isNull(pushSubscription.disabledAt),
      or(eq(pushSubscription.signInEnabled, true), eq(pushSubscription.signOutEnabled, true)),
    ));

  if (subscriptions.length === 0) return summary;

  const payload = buildLatenessPaymentReceiptPushPayload(payment);

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          auth: subscription.auth,
          p256dh: subscription.p256dh,
        },
      }, JSON.stringify(payload));
      summary.sent += 1;
    } catch (error) {
      const expiredEndpoint = isExpiredPushEndpoint(error);
      if (expiredEndpoint) {
        await db.update(pushSubscription)
          .set({
            disabledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pushSubscription.id, subscription.id));
        summary.disabled += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}
