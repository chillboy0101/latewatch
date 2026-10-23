import 'server-only';

import { gunzipSync } from 'node:zlib';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BACKUP_FORMAT_V1,
  BACKUP_FORMAT_V2,
  BACKUP_PREFIX,
  backupDateOfId,
  backupIdFromManifestKey,
  backupKeysForId,
  backupSourceOf,
  expiredBackupIds,
  isBackupId,
  newBackupId,
  type BackupManifest,
  type BackupSource,
  type BackupTableName,
} from '@/lib/backup-format';
import { buildBackupFile, sha256Hex, snapshotTables } from '@/lib/data-backup-core';
import { RestoreError, v1RowsToColumns, type BackupTables } from '@/lib/data-restore-core';
import { getAccraDateKey } from '@/lib/date-key';
import { withDbClient } from '@/lib/db-pool';
import { getR2Client } from '@/lib/r2/client';

// Copies of LateWatch's business data, kept in Cloudflare R2 so they survive anything that happens
// to the Neon database: every Sunday, on "Back Up Now", and just before a restore. Each backup is
// one gzipped JSON file plus a small manifest; the last 12 weeks are kept.

export type BackupListItem = BackupManifest & { id: string; source: BackupSource };

function bucket() {
  const name = process.env.CF_R2_BUCKET;
  if (!name) throw new Error('Cloudflare R2 bucket is required');
  return name;
}

export async function createDataBackup(input: { createdBy: string; source: BackupSource }) {
  const now = new Date();
  const id = newBackupId(now);
  const createdAt = now.toISOString();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const { rowCounts, tables } = await withDbClient((client) => snapshotTables(client));
  const { body, sha256 } = buildBackupFile({ commit, createdAt, id, tables });
  const { backupKey, manifestKey } = backupKeysForId(id);
  const manifest: BackupManifest = {
    backupKey,
    commit,
    createdAt,
    createdBy: input.createdBy,
    date: getAccraDateKey(now),
    format: BACKUP_FORMAT_V2,
    id,
    rowCounts,
    sha256,
    sizeBytes: body.length,
    source: input.source,
    totalRows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0),
  };

  const r2 = getR2Client();
  await r2.send(new PutObjectCommand({ Body: body, Bucket: bucket(), ContentType: 'application/gzip', Key: backupKey }));
  // The manifest goes last: a backup only lists once its file is fully stored.
  await r2.send(new PutObjectCommand({
    Body: JSON.stringify(manifest, null, 2),
    Bucket: bucket(),
    ContentType: 'application/json',
    Key: manifestKey,
  }));

  const removed = await pruneOldBackups(getAccraDateKey(now));
  return { manifest, removed };
}

async function listBackupIds() {
  const r2 = getR2Client();
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const listed = await r2.send(new ListObjectsV2Command({ Bucket: bucket(), ContinuationToken: token, Prefix: BACKUP_PREFIX }));
    for (const object of listed.Contents || []) {
      const id = object.Key ? backupIdFromManifestKey(object.Key) : null;
      if (id) ids.push(id);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

async function pruneOldBackups(today: string) {
  const r2 = getR2Client();
  const expired = expiredBackupIds(await listBackupIds(), today);
  for (const id of expired) {
    const { backupKey, manifestKey } = backupKeysForId(id);
    await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: manifestKey }));
    await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: backupKey }));
  }
  return expired.length;
}

async function readManifest(id: string): Promise<BackupListItem | null> {
  try {
    const object = await getR2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: backupKeysForId(id).manifestKey }));
    const manifest = JSON.parse(await object.Body!.transformToString()) as BackupManifest;
    return {
      ...manifest,
      id,
      source: backupSourceOf(manifest),
    };
  } catch {
    return null;
  }
}

// Newest first.
export async function listDataBackups() {
  const manifests = await Promise.all((await listBackupIds()).map(readManifest));
  return manifests
    .filter((manifest): manifest is BackupListItem => Boolean(manifest))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBackupDownloadUrl(id: string) {
  if (!isBackupId(id)) throw new RestoreError('Invalid backup.');
  const { backupKey } = backupKeysForId(id);
  return getSignedUrl(getR2Client(), new GetObjectCommand({
    Bucket: bucket(),
    Key: backupKey,
    ResponseContentDisposition: `attachment; filename="latewatch-${id}.json.gz"`,
  }), { expiresIn: 300 });
}

// The backup's rows by table, checked against its manifest (checksum, format, row counts).
export async function readBackupTables(id: string) {
  if (!isBackupId(id)) throw new RestoreError('Invalid backup.');
  const manifest = await readManifest(id);
  if (!manifest) throw new RestoreError('That backup was not found.');

  const object = await getR2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: backupKeysForId(id).backupKey }));
  const body = await object.Body!.transformToByteArray();
  if (manifest.sha256 && sha256Hex(body) !== manifest.sha256) {
    throw new RestoreError('This backup file is damaged (its checksum does not match), so it was not restored.');
  }
  if (body.length !== manifest.sizeBytes) {
    throw new RestoreError('This backup file is incomplete, so it was not restored.');
  }

  let parsed: { format?: string; tables?: Record<string, unknown> };
  try {
    parsed = JSON.parse(gunzipSync(body).toString('utf8'));
  } catch {
    throw new RestoreError('This backup file could not be read, so it was not restored.');
  }
  if (parsed.format !== BACKUP_FORMAT_V1 && parsed.format !== BACKUP_FORMAT_V2) {
    throw new RestoreError('This backup is in an unknown format, so it was not restored.');
  }
  if (!parsed.tables || typeof parsed.tables !== 'object') throw new RestoreError('This backup has no data.');

  const tables: BackupTables = {};
  for (const [name, rows] of Object.entries(parsed.tables)) {
    if (!Array.isArray(rows)) throw new RestoreError(`Backup table ${name} is not a list of rows.`);
    if (manifest.rowCounts[name] !== undefined && manifest.rowCounts[name] !== rows.length) {
      throw new RestoreError(`Backup table ${name} has ${rows.length} rows but its manifest says ${manifest.rowCounts[name]}.`);
    }
    tables[name as BackupTableName] = parsed.format === BACKUP_FORMAT_V1
      ? v1RowsToColumns(name, rows as Record<string, unknown>[])
      : rows as Record<string, unknown>[];
  }
  return { date: backupDateOfId(id), manifest, tables };
}
