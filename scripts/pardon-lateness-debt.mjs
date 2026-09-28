import { createHash, randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--confirm-pardon');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{32}$/i;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function accraDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Africa/Accra',
    year: 'numeric',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function snapshotHash(rows) {
  const snapshot = rows.slice().sort((left, right) => (
    left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0
  )).map((row) => [
    row.entryId,
    row.staffId,
    dateKey(row.entryDate),
    amount(row.penaltyAmount),
    amount(row.paidAmount),
    amount(row.forgivenAmount),
  ].join(':')).join('|');
  return createHash('md5').update(snapshot).digest('hex');
}

function printUsage() {
  console.log('Usage: node scripts/pardon-lateness-debt.mjs --reason TEXT --operator-email EMAIL --idempotency-key KEY [--operator-user-id UUID]');
  console.log('Preview is read-only and runs by default. After reviewing its snapshot, apply with:');
  console.log('  --apply --confirm-pardon --expected-snapshot-hash HASH');
  console.log('The caller must reconcile attendance penalties before previewing. This script never runs attendance sync.');
}

const reason = argument('--reason')?.trim();
const operatorEmail = argument('--operator-email')?.trim().toLowerCase();
const operatorUserId = argument('--operator-user-id')?.trim() || null;
const idempotencyKey = argument('--idempotency-key')?.trim();
const expectedSnapshotHash = argument('--expected-snapshot-hash')?.trim().toLowerCase();

if (process.argv.includes('--help')) {
  printUsage();
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}
if (!reason || !operatorEmail || !idempotencyKey) {
  printUsage();
  console.error('Reason, operator email, and idempotency key are required for preview and apply.');
  process.exit(1);
}
if (!EMAIL_PATTERN.test(operatorEmail) || reason.length > 500 || idempotencyKey.length > 200) {
  console.error('Provide a valid operator email, a reason up to 500 characters, and an idempotency key up to 200 characters.');
  process.exit(1);
}
if (operatorUserId && !UUID_PATTERN.test(operatorUserId)) {
  console.error('Operator user ID must be a UUID when provided.');
  process.exit(1);
}
if (APPLY && !CONFIRM) {
  console.error('Apply requires --confirm-pardon.');
  process.exit(1);
}
if (APPLY && !HASH_PATTERN.test(expectedSnapshotHash || '')) {
  console.error('Apply requires the reviewed --expected-snapshot-hash from a dry run.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const cutoffAt = new Date();
const cutoffDate = accraDateKey(cutoffAt);

const CANDIDATES_SQL = `
  WITH allocation_totals AS (
    SELECT entry_id, SUM(GREATEST(allocated_amount, 0)) AS paid_amount
    FROM lateness_payment_allocation
    GROUP BY entry_id
  ), candidates AS (
    SELECT
      le.id::text AS "entryId",
      le.staff_id::text AS "staffId",
      le.date AS "entryDate",
      s.full_name AS "staffName",
      COALESCE(s.active, false) AS active,
      COALESCE(s.archived, false) AS archived,
      COALESCE(s.is_attendance_only, false) AS "isAttendanceOnly",
      le.computed_amount::numeric(10, 2) AS "penaltyAmount",
      LEAST(COALESCE(at.paid_amount, 0), le.computed_amount)::numeric(10, 2) AS "paidAmount",
      GREATEST(le.computed_amount - LEAST(COALESCE(at.paid_amount, 0), le.computed_amount), 0)::numeric(10, 2) AS "forgivenAmount"
    FROM lateness_entry le
    JOIN staff s ON s.id = le.staff_id
    LEFT JOIN allocation_totals at ON at.entry_id = le.id
    WHERE le.date <= $1::date
      AND le.computed_amount > 0
      AND le.computed_amount > LEAST(COALESCE(at.paid_amount, 0), le.computed_amount)
      AND NOT EXISTS (
        SELECT 1
        FROM lateness_debt_pardon_entry p
        WHERE p.entry_id = le.id
      )
  )
  SELECT *
  FROM candidates
  ORDER BY "staffName", "staffId", "entryDate", "entryId"
`;

async function getCandidates() {
  return sql.query(CANDIDATES_SQL, [cutoffDate]);
}

function printPreview(rows, hash) {
  const byStaff = new Map();
  for (const row of rows) {
    const item = byStaff.get(row.staffId) || {
      archived: row.archived,
      count: 0,
      forgiven: 0,
      name: row.staffName,
      paid: 0,
      penalty: 0,
      active: row.active,
      attendanceOnly: row.isAttendanceOnly,
    };
    item.count += 1;
    item.penalty += Number(row.penaltyAmount);
    item.paid += Number(row.paidAmount);
    item.forgiven += Number(row.forgivenAmount);
    byStaff.set(row.staffId, item);
  }

  const totals = rows.reduce((sum, row) => ({
    forgiven: sum.forgiven + Number(row.forgivenAmount),
    paid: sum.paid + Number(row.paidAmount),
    penalty: sum.penalty + Number(row.penaltyAmount),
  }), { forgiven: 0, paid: 0, penalty: 0 });

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Cutoff: ${cutoffAt.toISOString()} (${cutoffDate} Africa/Accra)`);
  console.log(`Reason: ${reason}`);
  console.log(`Operator: ${operatorEmail}`);
  console.log(`Idempotency key: ${idempotencyKey}`);
  console.log(`Affected entries: ${rows.length}`);
  console.log(`Affected staff accounts: ${byStaff.size}`);
  console.log(`Penalty total on affected entries: GHC ${amount(totals.penalty)}`);
  console.log(`Previously allocated payments: GHC ${amount(totals.paid)}`);
  console.log(`Debt to pardon: GHC ${amount(totals.forgiven)}`);
  console.log(`Snapshot hash: ${hash}`);
  console.log('');
  console.log('Account breakdown:');
  for (const item of byStaff.values()) {
    const flags = [
      item.active ? 'active' : 'inactive',
      item.archived ? 'archived' : 'not archived',
      item.attendanceOnly ? 'attendance-only' : 'standard',
    ].join(', ');
    console.log(`- ${item.name} (${flags}): ${item.count} entries, penalty GHC ${amount(item.penalty)}, paid GHC ${amount(item.paid)}, pardon GHC ${amount(item.forgiven)}`);
  }
}

async function findExistingPardon() {
  const rows = await sql`
    SELECT id, reason, actor_email, actor_user_id, entry_count, staff_count,
      original_penalty_total, paid_total, pardoned_total, snapshot_hash, cutoff_at
    FROM lateness_debt_pardon
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function applyPardon(hash) {
  const pardonId = randomUUID();
  const applySql = `
    WITH allocation_totals AS (
      SELECT entry_id, SUM(GREATEST(allocated_amount, 0)) AS paid_amount
      FROM lateness_payment_allocation
      GROUP BY entry_id
    ), candidates AS MATERIALIZED (
      SELECT
        le.id AS entry_id,
        le.staff_id,
        le.date AS entry_date,
        le.computed_amount::numeric(10, 2) AS penalty_amount,
        LEAST(COALESCE(at.paid_amount, 0), le.computed_amount)::numeric(10, 2) AS paid_amount,
        GREATEST(le.computed_amount - LEAST(COALESCE(at.paid_amount, 0), le.computed_amount), 0)::numeric(10, 2) AS forgiven_amount
      FROM lateness_entry le
      LEFT JOIN allocation_totals at ON at.entry_id = le.id
      WHERE le.date <= $3::date
        AND le.computed_amount > 0
        AND le.computed_amount > LEAST(COALESCE(at.paid_amount, 0), le.computed_amount)
        AND NOT EXISTS (
          SELECT 1 FROM lateness_debt_pardon_entry p WHERE p.entry_id = le.id
        )
    ), snapshot AS (
      SELECT
        COUNT(*)::integer AS entry_count,
        COUNT(DISTINCT staff_id)::integer AS staff_count,
        COALESCE(SUM(penalty_amount), 0)::numeric(12, 2) AS penalty_total,
        COALESCE(SUM(paid_amount), 0)::numeric(12, 2) AS paid_total,
        COALESCE(SUM(forgiven_amount), 0)::numeric(12, 2) AS pardoned_total,
        MD5(COALESCE(STRING_AGG(
          entry_id::text || ':' || staff_id::text || ':' || entry_date::text || ':' ||
          penalty_amount::text || ':' || paid_amount::text || ':' || forgiven_amount::text,
          '|' ORDER BY entry_id
        ), '')) AS snapshot_hash
      FROM candidates
    ), inserted_pardon AS (
      INSERT INTO lateness_debt_pardon (
        id, cutoff_at, cutoff_date, reason, actor_user_id, actor_email,
        idempotency_key, snapshot_hash, entry_count, staff_count,
        original_penalty_total, paid_total, pardoned_total
      )
      SELECT
        $1::uuid, $2::timestamptz, $3::date, $4::text, $5::text, $6::text,
        $7::text, snapshot.snapshot_hash, snapshot.entry_count, snapshot.staff_count,
        snapshot.penalty_total, snapshot.paid_total, snapshot.pardoned_total
      FROM snapshot
      WHERE snapshot.snapshot_hash = $8::text
      RETURNING id, entry_count, staff_count, original_penalty_total, paid_total, pardoned_total, snapshot_hash
    ), inserted_details AS (
      INSERT INTO lateness_debt_pardon_entry (
        pardon_id, entry_id, staff_id, entry_date, penalty_amount, paid_amount, forgiven_amount
      )
      SELECT
        inserted_pardon.id, candidates.entry_id, candidates.staff_id, candidates.entry_date,
        candidates.penalty_amount, candidates.paid_amount, candidates.forgiven_amount
      FROM inserted_pardon
      CROSS JOIN candidates
      RETURNING id
    ), inserted_audit AS (
      INSERT INTO audit_event (
        entity_type, entity_id, action, before_json, after_json, actor_user_id, actor_email
      )
      SELECT
        'lateness_debt_pardon', inserted_pardon.id::text, 'CREATE', NULL,
        jsonb_build_object(
          'cutoffAt', $2::timestamptz,
          'cutoffDate', $3::date,
          'entryCount', inserted_pardon.entry_count,
          'staffCount', inserted_pardon.staff_count,
          'originalPenaltyTotal', inserted_pardon.original_penalty_total,
          'paidTotal', inserted_pardon.paid_total,
          'pardonedTotal', inserted_pardon.pardoned_total,
          'snapshotHash', inserted_pardon.snapshot_hash,
          'reason', $4::text
        ),
        $9::uuid, $6::text
      FROM inserted_pardon
      RETURNING id
    )
    SELECT
      inserted_pardon.id,
      inserted_pardon.entry_count,
      inserted_pardon.staff_count,
      inserted_pardon.original_penalty_total,
      inserted_pardon.paid_total,
      inserted_pardon.pardoned_total,
      inserted_pardon.snapshot_hash,
      (SELECT COUNT(*)::integer FROM inserted_details) AS details_written,
      (SELECT COUNT(*)::integer FROM inserted_audit) AS audit_written
    FROM inserted_pardon
  `;
  const rows = await sql.query(applySql, [
    pardonId,
    cutoffAt.toISOString(),
    cutoffDate,
    reason,
    operatorUserId,
    operatorEmail,
    idempotencyKey,
    hash,
    operatorUserId && UUID_PATTERN.test(operatorUserId) ? operatorUserId : null,
  ]);
  return rows[0] || null;
}

try {
  const tables = await sql`
    SELECT to_regclass('lateness_debt_pardon') AS pardon_table,
      to_regclass('lateness_debt_pardon_entry') AS detail_table
  `;
  if (!tables[0]?.pardon_table || !tables[0]?.detail_table) {
    throw new Error('Pardon tables are missing. Apply drizzle/0030_lateness_debt_pardon.sql before using this script.');
  }

  const existing = await findExistingPardon();
  if (existing) {
    if (
      existing.reason !== reason
      || existing.actor_email.toLowerCase() !== operatorEmail
      || (existing.actor_user_id || null) !== operatorUserId
    ) {
      throw new Error('This idempotency key already belongs to a pardon with different operator or reason metadata.');
    }
    console.log(`Pardon ${existing.id} was already recorded; no changes made.`);
    console.log(`Affected entries: ${existing.entry_count}; debt pardoned: GHC ${amount(existing.pardoned_total)}.`);
    process.exit(0);
  }

  const rows = await getCandidates();
  const hash = snapshotHash(rows);
  printPreview(rows, hash);

  if (!APPLY) {
    console.log('Read-only preview complete. Review totals and account coverage before applying.');
    process.exit(0);
  }

  if (expectedSnapshotHash !== hash) {
    throw new Error(`Snapshot changed. No pardon was applied. Re-run dry run; current snapshot hash is ${hash}.`);
  }

  const result = await applyPardon(hash);
  if (!result) {
    throw new Error(`Database snapshot changed during apply. No pardon was applied; current reviewed hash was ${hash}. Re-run dry run.`);
  }
  if (result.snapshot_hash !== hash || result.details_written !== result.entry_count || result.audit_written !== 1) {
    throw new Error(`Pardon write verification failed for event ${result.id}; inspect the committed event before retrying.`);
  }

  console.log(`Pardon ${result.id} recorded atomically.`);
  console.log(`Affected entries: ${result.entry_count}; affected staff: ${result.staff_count}.`);
  console.log(`Penalty: GHC ${amount(result.original_penalty_total)}; previously paid: GHC ${amount(result.paid_total)}; pardoned: GHC ${amount(result.pardoned_total)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Debt pardon failed.');
  process.exitCode = 1;
}