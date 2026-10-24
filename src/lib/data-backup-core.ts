// Reads every backed-up table at one moment and builds the backup file. Works with any client that
// has pg's `query(text, params)` (Neon's Pool in the app, `pg` in tests).

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BACKUP_FORMAT_V2, BACKUP_TABLE_ORDER } from '@/lib/backup-format';
import type { QueryClient } from '@/lib/data-restore-core';

// One read-only, repeatable-read transaction: every table is read as of the same instant, so a
// payment can't be in the backup without the charges it pays. Rows keep their column names and
// Postgres's own JSON for each type (dates stay dates, amounts stay exact).
export async function snapshotTables(client: QueryClient) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const snapshot = await readTables(client);
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

// Every backed-up table, read inside the caller's transaction (the restore reads its safety copy
// this way, after locking the tables, so nothing can be written in between).
export async function readTables(client: QueryClient) {
  const tables: Record<string, string> = {};
  const rowCounts: Record<string, number> = {};
  for (const table of BACKUP_TABLE_ORDER) {
    const { rows: [row] } = await client.query(
      `SELECT count(*)::int AS n, coalesce(json_agg(t ORDER BY t.id), '[]'::json)::text AS rows FROM "${table}" t`,
    );
    tables[table] = String(row?.rows ?? '[]');
    rowCounts[table] = Number(row?.n ?? 0);
  }
  return { rowCounts, tables };
}

// The gzipped file and its checksum. Table JSON is spliced in as text, never re-parsed.
export function buildBackupFile(input: { commit: string | null; createdAt: string; id: string; tables: Record<string, string> }) {
  const tablesJson = `{${Object.entries(input.tables).map(([name, rows]) => `${JSON.stringify(name)}:${rows}`).join(',')}}`;
  const json = `{"format":${JSON.stringify(BACKUP_FORMAT_V2)},"id":${JSON.stringify(input.id)},"createdAt":${JSON.stringify(input.createdAt)},"commit":${JSON.stringify(input.commit)},"tables":${tablesJson}}`;
  const body = gzipSync(json);
  return { body, sha256: sha256Hex(body) };
}

export function sha256Hex(data: Uint8Array) {
  return createHash('sha256').update(data).digest('hex');
}
