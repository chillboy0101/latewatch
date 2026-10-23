// Loads a backup's rows back into the database in one transaction. Works with any client that has
// pg's `query(text, params)` (Neon's Pool in the app, `pg` in tests). Any error rolls it all back.

import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  BACKUP_TABLE_ORDER,
  RESTORE_KEPT_TABLES,
  RESTORE_TRIGGER_TABLES,
  chunkRows,
  type BackupTableName,
} from '@/lib/backup-format';

export type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export type BackupTables = Partial<Record<BackupTableName, Record<string, unknown>[]>>;

const INSERT_CHUNK = 500;
const RESTORE_LOCK = 'latewatch-backup-restore';

export class RestoreError extends Error {}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

const drizzleTables = new Map<string, Table>();
for (const value of Object.values(schema) as unknown[]) {
  if (is(value, Table)) drizzleTables.set(getTableName(value), value);
}

// Version 1 backups stored Drizzle's camelCase field names; map them back to column names.
export function v1RowsToColumns(tableName: string, rows: Record<string, unknown>[]) {
  const table = drizzleTables.get(tableName);
  if (!table) throw new RestoreError(`Backup has an unknown table: ${tableName}`);
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [columns[key]?.name ?? key, value]),
  ));
}

// Backups from before staff types (18 Oct 2026) have only the two flags; give each row the type
// those flags mean, so the flags and staff_type never disagree after a restore.
export function withStaffType(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    if ('staff_type' in row) return row;
    const staffType = row.is_attendance_only === true ? 'special' : row.is_nss_personnel === true ? 'nss' : 'main';
    return { ...row, staff_type: staffType };
  });
}

// The backup's tables in restore order, refusing anything that could wipe the database by mistake.
export function backupTablesInOrder(tables: BackupTables) {
  const unknown = Object.keys(tables).filter((name) => !(BACKUP_TABLE_ORDER as readonly string[]).includes(name));
  if (unknown.length > 0) throw new RestoreError(`Backup has unknown tables: ${unknown.join(', ')}`);
  for (const name of Object.keys(tables)) {
    if (!Array.isArray(tables[name as BackupTableName])) throw new RestoreError(`Backup table ${name} is not a list of rows.`);
  }
  if (!tables.staff || tables.staff.length === 0) throw new RestoreError('Backup has no staff, so it was not restored.');
  return BACKUP_TABLE_ORDER.filter((name) => tables[name] !== undefined);
}

async function tableColumns(client: QueryClient, table: string) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  if (rows.length === 0) throw new RestoreError(`Table ${table} is missing from the database.`);
  return rows.map((row) => String(row.column_name));
}

async function insertRows(client: QueryClient, table: string, rows: Record<string, unknown>[], upsert: boolean) {
  if (rows.length === 0) return;
  const tableCols = await tableColumns(client, table);
  // Only columns the backup has, so newer columns take their defaults instead of NULL.
  const present = new Set(rows.flatMap((row) => Object.keys(row)));
  const columns = tableCols.filter((column) => present.has(column));
  if (!columns.includes('id')) throw new RestoreError(`Backup rows for ${table} have no id.`);
  const list = columns.map(quoteIdent).join(', ');
  const conflict = upsert
    ? ` ON CONFLICT (id) DO UPDATE SET ${columns.filter((column) => column !== 'id').map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
    : '';
  for (const chunk of chunkRows(rows, INSERT_CHUNK)) {
    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${quoteIdent(table)}, $1::jsonb)${conflict}`,
      [JSON.stringify(chunk)],
    );
  }
}

// Replaces the backed-up tables with the backup's rows. Tables the backup doesn't have are left
// as they are. Returns the restored row count per table.
export async function restoreTables(client: QueryClient, tables: BackupTables) {
  const order = backupTablesInOrder(tables);
  const kept = new Set<string>(RESTORE_KEPT_TABLES);

  await client.query('BEGIN');
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [RESTORE_LOCK]);
    if (!lock?.locked) throw new RestoreError('Another restore is running. Try again in a minute.');
    // No check-in or edit can land mid-restore and survive it or upset the row counts; they wait
    // (a few seconds) and then run against the restored data.
    await client.query(`LOCK TABLE ${order.map(quoteIdent).join(', ')} IN ACCESS EXCLUSIVE MODE`);

    // The overlap checks would fire on half-loaded data; the backup itself was consistent.
    for (const table of RESTORE_TRIGGER_TABLES) {
      await client.query(`ALTER TABLE ${quoteIdent(table)} DISABLE TRIGGER USER`);
    }

    const keptIds = (table: string) => (tables[table as BackupTableName] || []).map((row) => String(row.id));
    // Check-in attempts aren't backed up; unlink them from staff and locations that will go.
    await client.query(
      'UPDATE attendance_attempt SET staff_id = NULL WHERE staff_id IS NOT NULL AND NOT (staff_id = ANY($1::uuid[]))',
      [keptIds('staff')],
    );
    if (order.includes('office_location')) {
      await client.query(
        'UPDATE attendance_attempt SET office_location_id = NULL WHERE office_location_id IS NOT NULL AND NOT (office_location_id = ANY($1::uuid[]))',
        [keptIds('office_location')],
      );
    }

    // Children first, so nothing still points at a row being removed.
    for (const table of [...order].reverse()) {
      if (kept.has(table)) {
        await client.query(`DELETE FROM ${quoteIdent(table)} WHERE NOT (id = ANY($1::uuid[]))`, [keptIds(table)]);
      } else {
        await client.query(`DELETE FROM ${quoteIdent(table)}`);
      }
    }
    // Parents first.
    for (const table of order) {
      const rows = tables[table] || [];
      await insertRows(client, table, table === 'staff' ? withStaffType(rows) : rows, kept.has(table));
    }

    for (const table of RESTORE_TRIGGER_TABLES) {
      await client.query(`ALTER TABLE ${quoteIdent(table)} ENABLE TRIGGER USER`);
    }

    const restored: Record<string, number> = {};
    for (const table of order) {
      const { rows: [count] } = await client.query(`SELECT count(*)::int AS n FROM ${quoteIdent(table)}`);
      restored[table] = Number(count?.n ?? 0);
      const expected = tables[table]?.length ?? 0;
      if (restored[table] !== expected) {
        throw new RestoreError(`${table}: expected ${expected} rows after restore, found ${restored[table]}.`);
      }
    }

    await client.query('COMMIT');
    return restored;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
