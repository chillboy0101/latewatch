import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { deviceTransferRequest, staffDevice } from '@/db/schema';
import { hashDeviceToken, legacyHashDeviceToken } from '@/lib/device-binding';

/**
 * Turns a device token into the hash stored in the database, migrating the stored rows onto
 * the current signing secret when they are still on the previous one.
 *
 * A phone holds the raw token and sends it with every request, so rotating the secret does
 * not have to unbind anyone: the first request after the rotation still presents a token
 * that hashes to the old value under the old secret, which is enough to recognise the device
 * and rewrite its row.
 *
 * DEPLOYMENT ORDER: this code must be live *before* DEVICE_BINDING_SECRET is set. With the
 * variable unset, legacyHashDeviceToken() returns null and this is byte-for-byte the old
 * behaviour. Setting the variable first, on a deployment without this fallback, would
 * invalidate every trusted device at once.
 */
export async function resolveDeviceHash(deviceToken: string): Promise<string> {
  const deviceHash = hashDeviceToken(deviceToken);
  const legacyHash = legacyHashDeviceToken(deviceToken);

  // Nothing rotated, or the token already re-keyed.
  if (!legacyHash || legacyHash === deviceHash) return deviceHash;

  try {
    const [device] = await db.update(staffDevice)
      .set({ deviceHash, updatedAt: new Date() })
      .where(eq(staffDevice.deviceHash, legacyHash))
      .returning({ id: staffDevice.id });

    const transfers = await db.update(deviceTransferRequest)
      .set({ deviceHash, updatedAt: new Date() })
      .where(eq(deviceTransferRequest.deviceHash, legacyHash))
      .returning({ id: deviceTransferRequest.id });

    if (device || transfers.length) {
      // Watch this in the logs. Once it stops appearing, every device has re-keyed and the
      // legacy branch here (and the fallback chain in device-binding.ts) can be deleted.
      console.info('device-rekey: migrated device binding to the current secret', {
        staffDeviceUpdated: Boolean(device),
        transferRequestsUpdated: transfers.length,
      });
    }
  } catch (error) {
    // A failed migration must not block attendance. The device simply stays on the old hash
    // and gets another chance on the next request.
    console.error('device-rekey: could not migrate device binding', error);
  }

  return deviceHash;
}
