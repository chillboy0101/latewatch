import { NextRequest, NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { createDataBackup, getBackupDownloadUrl, listDataBackups } from '@/lib/data-backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'Cache-Control': 'no-store' };

// GET: list backups, or ?download=YYYY-MM-DD for a 5-minute download link.
export async function GET(request: NextRequest) {
  const adminError = await enforceRole(['admin']);
  if (adminError) return NextResponse.json({ error: adminError.error }, { status: adminError.status });

  try {
    const download = request.nextUrl.searchParams.get('download');
    if (download) {
      const url = await getBackupDownloadUrl(download);
      await tryWriteAuditEvent({ action: 'BACKUP_DOWNLOADED', entityId: download, entityType: 'data_backup' });
      return NextResponse.json({ url }, { headers: noStore });
    }
    return NextResponse.json({ backups: await listDataBackups() }, { headers: noStore });
  } catch (error) {
    console.error('Backup lookup failed:', error);
    return NextResponse.json({ error: 'Could not reach backup storage.' }, { status: 500, headers: noStore });
  }
}

// POST: back up now.
export async function POST() {
  const adminError = await enforceRole(['admin']);
  if (adminError) return NextResponse.json({ error: adminError.error }, { status: adminError.status });

  try {
    const actor = await getAuditActor();
    const { manifest, removed } = await createDataBackup(actor.actorEmail);
    await tryWriteAuditEvent({
      action: 'BACKUP_CREATED',
      after: { date: manifest.date, removedOld: removed, sizeBytes: manifest.sizeBytes, source: 'manual', totalRows: manifest.totalRows },
      entityId: manifest.date,
      entityType: 'data_backup',
    });
    return NextResponse.json({ backup: manifest }, { headers: noStore });
  } catch (error) {
    console.error('Manual backup failed:', error);
    return NextResponse.json({ error: 'Backup failed. Check the R2 settings.' }, { status: 500, headers: noStore });
  }
}
