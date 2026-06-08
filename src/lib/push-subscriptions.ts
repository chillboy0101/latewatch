import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { pushSubscription } from '@/db/schema';

export async function disableActivePushSubscriptionsForStaff(staffId: string, disabledAt = new Date()) {
  const disabledSubscriptions = await db.update(pushSubscription)
    .set({
      disabledAt,
      signInEnabled: false,
      signOutEnabled: false,
      updatedAt: disabledAt,
    })
    .where(and(
      eq(pushSubscription.staffId, staffId),
      isNull(pushSubscription.disabledAt),
    ))
    .returning({ id: pushSubscription.id });

  return disabledSubscriptions.length;
}
