import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushReminderDelivery } from '@/db/schema';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Called by the service worker when a push notification is actually
 * displayed on the device - not gated by Clerk auth, since a push event can
 * fire with no active browser session. The delivery id itself (an
 * unguessable UUID, never exposed anywhere else) is the only credential.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const deliveryId = typeof body?.deliveryId === 'string' ? body.deliveryId : '';

  if (!UUID_PATTERN.test(deliveryId)) {
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const [delivery] = await db.select({
    date: pushReminderDelivery.date,
    deliveredAt: pushReminderDelivery.deliveredAt,
    reminderType: pushReminderDelivery.reminderType,
    status: pushReminderDelivery.status,
  })
    .from(pushReminderDelivery)
    .where(eq(pushReminderDelivery.id, deliveryId))
    .limit(1);

  if (delivery && delivery.status === 'sent' && !delivery.deliveredAt) {
    await db.update(pushReminderDelivery)
      .set({ deliveredAt: new Date() })
      .where(eq(pushReminderDelivery.id, deliveryId));

    publishRealtime('attendance', 'invalidate', {
      date: delivery.date,
      reason: 'push-reminder-delivered',
      reminderType: delivery.reminderType,
    });
    publishRealtime('notifications', 'invalidate', {
      date: delivery.date,
      reason: 'push-reminder-delivered',
      reminderType: delivery.reminderType,
    });
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
