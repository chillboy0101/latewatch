import 'server-only';

import { gzipSync } from 'node:zlib';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db } from '@/db';
import {
  attendancePermission,
  attendanceRecord,
  auditEvent,
  contributionEntry,
  contributionSection,
  deviceTransferRequest,
  emergencyContact,
  entrySubmission,
  latenessDebtPardon,
  latenessDebtPardonEntry,
  latenessEntry,
  latenessPayment,
  latenessPaymentAllocation,
  offenceBookItem,
  officeLocation,
  officeNetwork,
  staff,
  staffDevice,
  staffLeavePeriod,
  templateVersion,
  workCalendar,
} from '@/db/schema';
import { getAccraDateKey } from '@/lib/date-key';
import { getR2Client } from '@/lib/r2/client';

// Weekly copy of LateWatch's business data, kept in Cloudflare R2 so it survives anything that
// happens to the Neon database. Each backup is one gzipped JSON file plus a small manifest.
// Logs and secrets that can be rebuilt (check-in attempts, push deliveries and subscriptions,
// cron runs, rate limits, notification reads, theme preferences) are left out.

export const BACKUP_PREFIX = 'backups/';
const KEEP_WEEKS = 12;

const BACKUP_TABLES = {
  attendance_permission: attendancePermission,
  attendance_record: attendanceRecord,
  audit_event: auditEvent,
  contribution_entry: contributionEntry,
  contribution_section: contributionSection,
  device_transfer_request: deviceTransferRequest,
  emergency_contact: emergencyContact,
  entry_submission: entrySubmission,
  lateness_debt_pardon: latenessDebtPardon,
  lateness_debt_pardon_entry: latenessDebtPardonEntry,
  lateness_entry: latenessEntry,
  lateness_payment: latenessPayment,
  lateness_payment_allocation: latenessPaymentAllocation,
  offence_book_item: offenceBookItem,
  office_location: officeLocation,
  office_network: officeNetwork,
  staff,
  staff_device: staffDevice,
  staff_leave_period: staffLeavePeriod,
  template_version: templateVersion,
  work_calendar: workCalendar,
} as const;

export const BACKUP_TABLE_NAMES = Object.keys(BACKUP_TABLES);

export type BackupManifest = {
  backupKey: string;
  commit: string | null;
  createdAt: string;
  createdBy: string;
  date: string;
  rowCounts: Record<string, number>;
  sizeBytes: number;
  totalRows: number;
};

function bucket() {
  const name = process.env.CF_R2_BUCKET;
  if (!name) throw new Error('Cloudflare R2 bucket is required');
  return name;
}

export function backupKeysForDate(date: string) {
  return {
    backupKey: `${BACKUP_PREFIX}latewatch-${date}.json.gz`,
    manifestKey: `${BACKUP_PREFIX}latewatch-${date}.manifest.json`,
  };
}

export function isOlderThanRetention(backupDate: string, today: string, keepWeeks = KEEP_WEEKS) {
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${backupDate}T00:00:00Z`)) / 86_400_000;
  return ageDays > keepWeeks * 7;
}

function dateFromKey(key: string) {
  return key.match(/latewatch-(\d{4}-\d{2}-\d{2})\.manifest\.json$/)?.[1] || null;
}

export async function createDataBackup(createdBy: string) {
  const date = getAccraDateKey();
  const tables: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};

  for (const [name, table] of Object.entries(BACKUP_TABLES)) {
    const rows = await db.select().from(table);
    tables[name] = rows;
    rowCounts[name] = rows.length;
  }

  const { backupKey, manifestKey } = backupKeysForDate(date);
  const createdAt = new Date().toISOString();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const body = gzipSync(JSON.stringify({ createdAt, commit, date, format: 'latewatch-backup/1', tables }));
  const manifest: BackupManifest = {
    backupKey,
    commit,
    createdAt,
    createdBy,
    date,
    rowCounts,
    sizeBytes: body.length,
    totalRows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0),
  };

  const r2 = getR2Client();
  await r2.send(new PutObjectCommand({
    Body: body,
    Bucket: bucket(),
    ContentType: 'application/gzip',
    Key: backupKey,
  }));
  await r2.send(new PutObjectCommand({
    Body: JSON.stringify(manifest, null, 2),
    Bucket: bucket(),
    ContentType: 'application/json',
    Key: manifestKey,
  }));

  const removed = await pruneOldBackups(date);
  return { manifest, removed };
}

async function listManifestKeys() {
  const r2 = getR2Client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const listed = await r2.send(new ListObjectsV2Command({ Bucket: bucket(), ContinuationToken: token, Prefix: BACKUP_PREFIX }));
    for (const object of listed.Contents || []) {
      if (object.Key && dateFromKey(object.Key)) keys.push(object.Key);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function pruneOldBackups(today: string) {
  const r2 = getR2Client();
  const expiredDates = (await listManifestKeys())
    .map((key) => dateFromKey(key) as string)
    .filter((date) => isOlderThanRetention(date, today));

  for (const date of expiredDates) {
    const { backupKey, manifestKey } = backupKeysForDate(date);
    await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: backupKey }));
    await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: manifestKey }));
  }
  return expiredDates.length;
}

export async function listDataBackups() {
  const r2 = getR2Client();
  const keys = await listManifestKeys();
  const manifests = await Promise.all(keys.map(async (key) => {
    try {
      const object = await r2.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return JSON.parse(await object.Body!.transformToString()) as BackupManifest;
    } catch {
      return null;
    }
  }));
  return manifests
    .filter((manifest): manifest is BackupManifest => Boolean(manifest))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getBackupDownloadUrl(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid backup date');
  const { backupKey } = backupKeysForDate(date);
  return getSignedUrl(getR2Client(), new GetObjectCommand({
    Bucket: bucket(),
    Key: backupKey,
    ResponseContentDisposition: `attachment; filename="latewatch-${date}.json.gz"`,
  }), { expiresIn: 300 });
}
