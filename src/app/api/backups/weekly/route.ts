import { NextRequest, NextResponse } from 'next/server';
import { tryWriteAuditEvent } from '@/lib/audit';
import { createDataBackup } from '@/lib/data-backup';
import { reminderCronSource, validateReminderCronAuth } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly backup to Cloudflare R2, run by the Vercel cron (see vercel.json).
export async function GET(request: NextRequest) {
  const guard = validateReminderCronAuth(request);
  if (!guard.ok) return guard.response;

  const source = reminderCronSource(request);
  try {
    const { manifest, removed } = await createDataBackup({ createdBy: `cron:${source}`, source: 'weekly' });
    await tryWriteAuditEvent({
      action: 'BACKUP_CREATED',
      actor: { email: 'system' },
      after: { id: manifest.id, removedOld: removed, sizeBytes: manifest.sizeBytes, source, totalRows: manifest.totalRows },
      entityId: manifest.id,
      entityType: 'data_backup',
    });
    return NextResponse.json({ id: manifest.id, removed, sizeBytes: manifest.sizeBytes, totalRows: manifest.totalRows }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Weekly backup failed:', error);
    // Recorded so a missed week shows up in the audit trail, not only in server logs.
    await tryWriteAuditEvent({
      action: 'BACKUP_FAILED',
      actor: { email: 'system' },
      after: { error: error instanceof Error ? error.message : String(error), source },
      entityId: new Date().toISOString().slice(0, 10),
      entityType: 'data_backup',
    });
    return NextResponse.json({ error: 'Backup failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
