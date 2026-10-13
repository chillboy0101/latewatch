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

  try {
    const source = reminderCronSource(request);
    const { manifest, removed } = await createDataBackup(`cron:${source}`);
    await tryWriteAuditEvent({
      action: 'BACKUP_CREATED',
      actor: { email: 'system' },
      after: { date: manifest.date, removedOld: removed, sizeBytes: manifest.sizeBytes, source, totalRows: manifest.totalRows },
      entityId: manifest.date,
      entityType: 'data_backup',
    });
    return NextResponse.json({ date: manifest.date, removed, sizeBytes: manifest.sizeBytes, totalRows: manifest.totalRows }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Weekly backup failed:', error);
    return NextResponse.json({ error: 'Backup failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
