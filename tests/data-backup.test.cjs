/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const format = require('../src/lib/backup-format.ts');
const core = require('../src/lib/data-restore-core.ts');
const backupCore = require('../src/lib/data-backup-core.ts');

test('each backup has its own id and file, so two backups on one day no longer overwrite each other', () => {
  const id = format.newBackupId(new Date('2026-10-23T20:44:05.123Z'));
  assert.equal(id, '2026-10-23T204405123Z');
  assert.deepEqual(format.backupKeysForId(id), {
    backupKey: 'backups/latewatch-2026-10-23T204405123Z.json.gz',
    manifestKey: 'backups/latewatch-2026-10-23T204405123Z.manifest.json',
  });
  assert.equal(format.backupIdFromManifestKey('backups/latewatch-2026-10-23T204405123Z.manifest.json'), id);
  assert.equal(format.isBackupId('2026-10-23T204405Z'), true);
  // Backups made before ids existed are still found.
  assert.equal(format.backupIdFromManifestKey('backups/latewatch-2026-10-18.manifest.json'), '2026-10-18');
  assert.equal(format.backupIdFromManifestKey('backups/latewatch-2026-10-18.json.gz'), null);
  assert.equal(format.isBackupId('../../etc'), false);
  assert.equal(format.backupDateOfId(id), '2026-10-23');
});

test('retention keeps 12 weeks and never removes the newest backup', () => {
  assert.equal(format.isOlderThanRetention('2026-07-26', '2026-10-18'), false); // exactly 12 weeks
  assert.equal(format.isOlderThanRetention('2026-07-25', '2026-10-18'), true);
  assert.deepEqual(format.expiredBackupIds(['2026-07-01', '2026-07-20T020000Z', '2026-10-18T020000Z'], '2026-10-18'), ['2026-07-01', '2026-07-20T020000Z']);
  // After a long gap the only backup left is old, but it stays.
  assert.deepEqual(format.expiredBackupIds(['2026-01-04', '2026-01-11T020000Z'], '2026-10-18'), ['2026-01-04']);
});

test('backups cover the business tables, including staff types and deactivations, and leave out logs', () => {
  for (const name of ['staff', 'staff_type_change', 'staff_inactive_period', 'attendance_record', 'lateness_entry', 'lateness_payment', 'lateness_payment_allocation', 'lateness_debt_pardon', 'attendance_permission', 'staff_leave_period', 'audit_event', 'work_calendar']) {
    assert.ok(format.BACKUP_TABLE_ORDER.includes(name), name);
  }
  for (const name of ['push_subscription', 'push_reminder_delivery', 'attendance_attempt', 'rate_limit', 'reminder_cron_run', 'notification_read', 'user_theme_preference']) {
    assert.ok(!format.BACKUP_TABLE_ORDER.includes(name), name);
  }
});

test('restore order puts every parent before the rows that point at it', () => {
  const order = format.BACKUP_TABLE_ORDER;
  const before = (parent, child) => assert.ok(order.indexOf(parent) < order.indexOf(child), `${parent} before ${child}`);
  for (const child of ['staff_type_change', 'staff_inactive_period', 'staff_leave_period', 'attendance_record', 'lateness_entry', 'lateness_payment', 'attendance_permission', 'staff_device', 'device_transfer_request', 'emergency_contact', 'lateness_debt_pardon_entry']) {
    before('staff', child);
  }
  before('office_location', 'attendance_record');
  before('contribution_section', 'contribution_entry');
  before('lateness_entry', 'lateness_payment_allocation');
  before('lateness_payment', 'lateness_payment_allocation');
  before('lateness_debt_pardon', 'lateness_debt_pardon_entry');
  before('lateness_entry', 'lateness_debt_pardon_entry');
});

test('a backup with no staff or unknown tables is refused before anything is touched', () => {
  assert.throws(() => core.backupTablesInOrder({ staff: [] }), /no staff/);
  assert.throws(() => core.backupTablesInOrder({ staff: [{ id: 'a' }], push_subscription: [] }), /unknown tables/);
  assert.throws(() => core.backupTablesInOrder({ staff: [{ id: 'a' }], lateness_entry: 'x' }), /not a list/);
  assert.deepEqual(core.backupTablesInOrder({ lateness_entry: [], staff: [{ id: 'a' }] }), ['staff', 'lateness_entry']);
});

test('old (v1) backups map field names back to column names', () => {
  const [row] = core.v1RowsToColumns('lateness_entry', [{ computedAmount: '10.00', id: 'x', staffId: 'y' }]);
  assert.deepEqual(row, { computed_amount: '10.00', id: 'x', staff_id: 'y' });
  assert.throws(() => core.v1RowsToColumns('nope', []), /unknown table/);
  // Backups from before staff types get the type their flags mean.
  assert.deepEqual(core.withStaffType([
    { id: 'a', is_attendance_only: true, is_nss_personnel: false },
    { id: 'b', is_attendance_only: false, is_nss_personnel: true },
    { id: 'c', is_attendance_only: false, is_nss_personnel: false },
    { id: 'd', is_attendance_only: true, staff_type: 'intern' },
  ]).map((row) => row.staff_type), ['special', 'nss', 'main', 'intern']);
});

test('the backup file is gzipped JSON with a checksum, tables spliced in as written', () => {
  const { body, sha256 } = backupCore.buildBackupFile({ commit: 'abc', createdAt: '2026-10-23T20:44:05.123Z', id: '2026-10-23T204405Z', tables: { staff: '[{"id":"a","amount":10.50}]' } });
  assert.equal(sha256, backupCore.sha256Hex(body));
  const parsed = JSON.parse(gunzipSync(body).toString());
  assert.equal(parsed.format, format.BACKUP_FORMAT_V2);
  assert.deepEqual(parsed.tables.staff, [{ amount: 10.5, id: 'a' }]);
  assert.match(gunzipSync(body).toString(), /"amount":10\.50/);
  assert.deepEqual(format.chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('restore runs in one transaction: rolls back on any error and re-checks every row count', () => {
  const source = read('src', 'lib', 'data-restore-core.ts');
  assert.match(source, /await client\.query\('BEGIN'\);/);
  assert.match(source, /catch \(error\) \{\s*await client\.query\('ROLLBACK'\)/);
  assert.match(source, /pg_try_advisory_xact_lock/);
  assert.match(source, /SET LOCAL lock_timeout/);
  assert.match(source, /LOCK TABLE \$\{order\.map\(quoteIdent\)\.join\(', '\)\} IN ACCESS EXCLUSIVE MODE/);
  assert.match(source, /table === 'staff' \? withStaffType\(rows\) : rows/);
  assert.match(source, /DISABLE TRIGGER USER[\s\S]*ENABLE TRIGGER USER/);
  assert.match(source, /expected \$\{expected\} rows after restore/);
  // Check-in attempts (never backed up) are unlinked, not deleted.
  assert.match(source, /UPDATE attendance_attempt SET staff_id = NULL/);
  const restore = read('src', 'lib', 'data-restore.ts');
  // The safety copy is stored inside the restore's transaction, once the tables are locked.
  assert.match(restore, /readBackupTables\(input\.id\);[\s\S]*restoreTables\(client, tables, \{\s*onLocked: async \(locked\) => \{\s*safetyBackupId = \(await createSafetyBackup\(locked, input\.actor\.email\)\)\.id;/);
  const backup = read('src', 'lib', 'data-backup.ts');
  assert.match(backup, /sha256Hex\(body\) !== manifest\.sha256/);
  // The safety copy never prunes (it could remove the very backup being restored).
  const safety = backup.slice(backup.indexOf('export async function createSafetyBackup'), backup.indexOf('async function storeBackup'));
  assert.doesNotMatch(safety, /pruneOldBackups/);
  // Storage being unreachable isn't reported as "not found"; a missing file says so.
  assert.match(backup, /if \(strict && !isNotFound\(error\)\) throw error;/);
  assert.match(backup, /This backup\\'s file is missing/);
  assert.match(read('src', 'app', 'api', 'admin', 'backups', 'restore', 'route.ts'), /code === '55P03'/);
  assert.match(read('src', 'lib', 'data-backup-core.ts'), /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
});

test('the weekly backup runs from a guarded cron, records failures, and backup routes are admin-only', () => {
  const cronRoute = read('src', 'app', 'api', 'backups', 'weekly', 'route.ts');
  const adminRoute = read('src', 'app', 'api', 'admin', 'backups', 'route.ts');
  const restoreRoute = read('src', 'app', 'api', 'admin', 'backups', 'restore', 'route.ts');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(cronRoute, /const guard = validateReminderCronAuth\(request\);\s*if \(!guard\.ok\) return guard\.response;/);
  assert.match(cronRoute, /action: 'BACKUP_FAILED'/);
  assert.equal((adminRoute.match(/await enforceRole\(\['admin'\]\)/g) || []).length, 2);
  assert.match(restoreRoute, /await enforceRole\(\['admin'\]\)/);
  assert.match(restoreRoute, /body\?\.confirm !== 'RESTORE'/);
  assert.match(restoreRoute, /allowRequest\(`backup-restore:/);
  assert.match(read('src', 'proxy.ts'), /'\/api\/backups\/weekly',/);
  assert.ok(vercel.crons.some((cron) => cron.path === '/api/backups/weekly' && cron.schedule === '0 2 * * 0'));
  assert.match(read('src', 'app', 'exports', 'page.tsx'), /<BackupsCard \/>/);
});

test('backups card shows real size changes, warns when the weekly backup is missed, and asks before restoring', () => {
  const card = require('../src/components/exports/backups-card.tsx');
  assert.equal(card.formatBackupSize(3_339_214), '3.18 MB');
  assert.equal(card.formatBackupSize(3_429_458), '3.27 MB');
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(card.isBackupStale('2026-10-18T02:23:00Z', now), true);
  assert.equal(card.isBackupStale('2026-10-25T02:00:00Z', now), false);
  assert.equal(card.isBackupStale(undefined, now), false);
  const source = read('src', 'components', 'exports', 'backups-card.tsx');
  assert.match(source, /disabled=\{confirmText !== 'RESTORE' \|\| busy === 'restore'\}/);
});

// End to end against a real Postgres (set LATEWATCH_TEST_PG_HOST to a socket dir with the
// LateWatch schema in database "lw"); skipped otherwise.
test('restore round trip on Postgres', { skip: !process.env.LATEWATCH_TEST_PG_HOST }, async () => {
  const pg = require('pg');
  const client = new pg.Client({ database: process.env.LATEWATCH_TEST_PG_DB || 'lw', host: process.env.LATEWATCH_TEST_PG_HOST, user: 'postgres' });
  await client.connect();
  try {
    const staffId = '11111111-1111-1111-1111-111111111111';
    const entryId = '22222222-2222-2222-2222-222222222222';
    const tables = {
      lateness_entry: [{ computed_amount: '10.00', date: '2026-10-20', id: entryId, reason: 'late', staff_id: staffId }],
      staff: [{ email: 'ama@example.com', full_name: 'Ama Mensah', id: staffId }],
      staff_type_change: [{ effective_from: '2000-01-01', id: '33333333-3333-3333-3333-333333333333', staff_id: staffId, staff_type: 'main' }],
    };
    await core.restoreTables(client, tables);
    const { rows: [attemptsBefore] } = await client.query('SELECT count(*)::int AS n FROM attendance_attempt WHERE staff_id = $1', [staffId]);
    await client.query(`INSERT INTO attendance_attempt (staff_id, user_email, date, network_ip, successful, result) VALUES ($1, 'a@x', '2026-10-21', '1.1.1.1', true, 'ok')`, [staffId]);
    await client.query(`UPDATE lateness_entry SET computed_amount = 99 WHERE id = $1`, [entryId]);
    const restored = await core.restoreTables(client, tables);
    assert.equal(restored.lateness_entry, 1);
    const { rows: [entry] } = await client.query('SELECT computed_amount::text AS a FROM lateness_entry WHERE id = $1', [entryId]);
    assert.equal(entry.a, '10.00');
    const { rows: [attempt] } = await client.query('SELECT count(*)::int AS n FROM attendance_attempt WHERE staff_id = $1', [staffId]);
    assert.equal(attempt.n, attemptsBefore.n + 1);
    // Two people in the backup swapped emails since: putting them back must not trip the unique index.
    const kofiId = '44444444-4444-4444-4444-444444444444';
    const withKofi = { ...tables, staff: [...tables.staff, { email: 'kofi@example.com', full_name: 'Kofi Boateng', id: kofiId }] };
    await core.restoreTables(client, withKofi);
    await client.query(`UPDATE staff SET email = 'tmp@example.com' WHERE id = $1`, [staffId]);
    await client.query(`UPDATE staff SET email = 'ama@example.com' WHERE id = $1`, [kofiId]);
    await client.query(`UPDATE staff SET email = 'kofi@example.com' WHERE id = $1`, [staffId]);
    const seen = [];
    await core.restoreTables(client, withKofi, { onLocked: async (locked) => {
      // The safety copy reads here: everything is locked and nothing has changed yet.
      const { rows: [row] } = await locked.query('SELECT email FROM staff WHERE id = $1', [kofiId]);
      seen.push(row.email);
    } });
    assert.deepEqual(seen, ['ama@example.com']);
    const { rows: emails } = await client.query('SELECT id, email FROM staff WHERE id = ANY($1::uuid[]) ORDER BY email', [[staffId, kofiId]]);
    assert.deepEqual(emails.map((row) => row.email), ['ama@example.com', 'kofi@example.com']);
    assert.equal(emails[0].id, staffId);
    // A bad row rolls the whole restore back.
    await assert.rejects(core.restoreTables(client, { ...tables, lateness_entry: [{ ...tables.lateness_entry[0], staff_id: '99999999-9999-9999-9999-999999999999' }] }));
    const { rows: [after] } = await client.query('SELECT count(*)::int AS n FROM lateness_entry WHERE id = $1', [entryId]);
    assert.equal(after.n, 1);
  } finally {
    await client.end();
  }
});
