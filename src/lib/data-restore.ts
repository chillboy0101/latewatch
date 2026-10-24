import 'server-only';

import { tryWriteAuditEvent } from '@/lib/audit';
import { createSafetyBackup, readBackupTables } from '@/lib/data-backup';
import { restoreTables } from '@/lib/data-restore-core';
import { withDbClient } from '@/lib/db-pool';
import { publishRealtime } from '@/lib/realtime';

const REFRESH_CHANNELS = ['attendance', 'audit-trail', 'contributions', 'dashboard', 'entries', 'notifications', 'payments', 'staff-penalty-history'];

// Puts a backup's data back. The backup is checked first; then, in one transaction, the tables are
// locked, a safety copy of today's data is stored (that is the undo), and everything is replaced.
// All or nothing: if storing the safety copy or any step fails, nothing changes.
export async function restoreDataBackup(input: { actor: { email: string; id?: string | null }; id: string }) {
  const { manifest, tables } = await readBackupTables(input.id);
  let safetyBackupId = '';
  const restored = await withDbClient((client) => restoreTables(client, tables, {
    onLocked: async (locked) => {
      safetyBackupId = (await createSafetyBackup(locked, input.actor.email)).id;
    },
  }));

  // Written after the restore, so the restored audit trail records it.
  await tryWriteAuditEvent({
    action: 'BACKUP_RESTORED',
    actor: input.actor,
    after: { backupCreatedAt: manifest.createdAt, restored, safetyBackupId },
    entityId: input.id,
    entityType: 'data_backup',
  });
  for (const channel of REFRESH_CHANNELS) publishRealtime(channel, 'invalidate', { reason: 'backup-restored' });

  return {
    keptAsIs: ['staff_type_change', 'staff_inactive_period'].filter((table) => !(table in tables)),
    restored,
    safetyBackupId,
  };
}
