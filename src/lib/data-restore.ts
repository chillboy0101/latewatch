import 'server-only';

import { tryWriteAuditEvent } from '@/lib/audit';
import { createDataBackup, readBackupTables } from '@/lib/data-backup';
import { restoreTables } from '@/lib/data-restore-core';
import { withDbClient } from '@/lib/db-pool';
import { publishRealtime } from '@/lib/realtime';

const REFRESH_CHANNELS = ['attendance', 'audit-trail', 'contributions', 'dashboard', 'entries', 'notifications', 'payments', 'staff-penalty-history'];

// Puts a backup's data back. The backup is checked first, then a safety backup of today's data is
// taken (that is the undo), then everything is replaced in one transaction: all or nothing.
export async function restoreDataBackup(input: { actor: { email: string; id?: string | null }; id: string }) {
  const { manifest, tables } = await readBackupTables(input.id);
  const { manifest: safety } = await createDataBackup({ createdBy: input.actor.email, source: 'before-restore' });
  const restored = await withDbClient((client) => restoreTables(client, tables));

  // Written after the restore, so the restored audit trail records it.
  await tryWriteAuditEvent({
    action: 'BACKUP_RESTORED',
    actor: input.actor,
    after: { backupCreatedAt: manifest.createdAt, restored, safetyBackupId: safety.id },
    entityId: input.id,
    entityType: 'data_backup',
  });
  for (const channel of REFRESH_CHANNELS) publishRealtime(channel, 'invalidate', { reason: 'backup-restored' });

  return {
    keptAsIs: ['staff_type_change', 'staff_inactive_period'].filter((table) => !(table in tables)),
    restored,
    safetyBackupId: safety.id!,
  };
}
