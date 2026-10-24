import { NextRequest, NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { isBackupId } from '@/lib/backup-format';
import { RestoreError } from '@/lib/data-restore-core';
import { restoreDataBackup } from '@/lib/data-restore';
import { allowRequest } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'Cache-Control': 'no-store' };

// POST { id, confirm: "RESTORE" }: replace today's data with a backup's. Admins only.
export async function POST(request: NextRequest) {
  const adminError = await enforceRole(['admin']);
  if (adminError) return NextResponse.json({ error: adminError.error }, { status: adminError.status });

  const body = await request.json().catch(() => ({}));
  if (!isBackupId(body?.id)) return NextResponse.json({ error: 'Choose a backup to restore.' }, { status: 400, headers: noStore });
  if (body?.confirm !== 'RESTORE') {
    return NextResponse.json({ error: 'Type RESTORE to confirm.' }, { status: 400, headers: noStore });
  }

  const actor = await getAuditActor();
  const limit = await allowRequest(`backup-restore:${actor.actorEmail}`, 3, 3600);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many restores. Try again later.' }, {
      headers: { ...noStore, 'Retry-After': String(limit.retryAfterSeconds) },
      status: 429,
    });
  }

  try {
    const result = await restoreDataBackup({ actor: { email: actor.actorEmail, id: actor.actorUserId }, id: body.id });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    await tryWriteAuditEvent({
      action: 'BACKUP_RESTORE_FAILED',
      after: { error: error instanceof Error ? error.message : String(error) },
      entityId: body.id,
      entityType: 'data_backup',
    });
    if (error instanceof RestoreError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
    // lock_not_available: the database was busy for longer than the restore waits.
    if ((error as { code?: string })?.code === '55P03') {
      return NextResponse.json({ error: 'The database was busy, so the restore stopped. Nothing was changed. Try again in a minute.' }, { status: 409, headers: noStore });
    }
    console.error('Backup restore failed:', error);
    return NextResponse.json({ error: 'Restore failed. Nothing was changed.' }, { status: 500, headers: noStore });
  }
}
