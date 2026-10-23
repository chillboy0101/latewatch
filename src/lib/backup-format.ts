// Shared, side-effect-free rules for LateWatch backups: which tables, in what order, how backups
// are named, and which ones the 12-week retention removes. Used by backup, restore and tests.

export const BACKUP_PREFIX = 'backups/';
export const BACKUP_FORMAT_V1 = 'latewatch-backup/1';
export const BACKUP_FORMAT_V2 = 'latewatch-backup/2';
export const KEEP_WEEKS = 12;

// Business tables, parents before children (restore inserts in this order and deletes in reverse).
// Logs and secrets that can be rebuilt (check-in attempts, push deliveries and subscriptions, cron
// runs, rate limits, notification reads, theme preferences) are left out.
export const BACKUP_TABLE_ORDER = [
  'staff',
  'office_location',
  'office_network',
  'work_calendar',
  'template_version',
  'contribution_section',
  'contribution_entry',
  'staff_type_change',
  'staff_inactive_period',
  'staff_leave_period',
  'staff_device',
  'device_transfer_request',
  'emergency_contact',
  'attendance_permission',
  'attendance_record',
  'entry_submission',
  'lateness_entry',
  'lateness_payment',
  'lateness_payment_allocation',
  'lateness_debt_pardon',
  'lateness_debt_pardon_entry',
  'offence_book_item',
  'audit_event',
] as const;

export type BackupTableName = typeof BACKUP_TABLE_ORDER[number];

// Rows that logs which are never backed up still point at (check-in attempts → staff and office
// location). These two are updated in place on restore instead of being emptied, so the logs survive.
export const RESTORE_KEPT_TABLES: readonly BackupTableName[] = ['staff', 'office_location'];

// Tables with the overlap-check triggers; they are paused while a restore loads consistent data.
export const RESTORE_TRIGGER_TABLES: readonly BackupTableName[] = ['staff_leave_period', 'attendance_permission', 'staff_inactive_period'];

export type BackupSource = 'manual' | 'weekly' | 'before-restore';

export type BackupManifest = {
  backupKey: string;
  commit: string | null;
  createdAt: string;
  createdBy: string;
  date: string;
  format?: string;
  id?: string;
  rowCounts: Record<string, number>;
  sha256?: string;
  sizeBytes: number;
  source?: BackupSource;
  totalRows: number;
};

// A backup's id: its UTC time to the second (2026-10-23T204400Z). Backups made before ids existed
// (one per day) use their date (2026-10-23).
const ID_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{6}Z)?$/;

export function isBackupId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function newBackupId(now: Date) {
  return now.toISOString().replace(/[-:]/g, '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{6})\.\d{3}Z$/, '$1-$2-$3T$4Z');
}

export function backupDateOfId(id: string) {
  return id.slice(0, 10);
}

export function backupKeysForId(id: string) {
  return {
    backupKey: `${BACKUP_PREFIX}latewatch-${id}.json.gz`,
    manifestKey: `${BACKUP_PREFIX}latewatch-${id}.manifest.json`,
  };
}

export function backupIdFromManifestKey(key: string) {
  const id = key.match(/latewatch-([0-9TZ-]+)\.manifest\.json$/)?.[1];
  return isBackupId(id) ? id : null;
}

export function isOlderThanRetention(backupDate: string, today: string, keepWeeks = KEEP_WEEKS) {
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${backupDate}T00:00:00Z`)) / 86_400_000;
  return ageDays > keepWeeks * 7;
}

// Backups past retention, never the newest one (a long gap must not leave no backup at all).
export function expiredBackupIds(ids: string[], today: string, keepWeeks = KEEP_WEEKS) {
  const newest = [...ids].sort().at(-1);
  return ids.filter((id) => id !== newest && isOlderThanRetention(backupDateOfId(id), today, keepWeeks));
}

export function backupSourceOf(manifest: Pick<BackupManifest, 'createdBy' | 'source'>): BackupSource {
  if (manifest.source) return manifest.source;
  return manifest.createdBy.startsWith('cron:') ? 'weekly' : 'manual';
}

export function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
