import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';

// Debt pardons forgive every unpaid lateness balance (everyone's, or one person's) dated on or before a cutoff date. Each pardon is
// recorded as one immutable event with a per-entry ledger, so payments, the offence book and the
// audit trail can show exactly what was forgiven. Debts dated after the cutoff stay owed.

export type DebtPardonStaffSummary = {
  entryCount: number;
  firstDate: string;
  forgivenAmount: string;
  fullName: string;
  isAttendanceOnly: boolean;
  lastDate: string;
  paidAmount: string;
  penaltyAmount: string;
  staffId: string;
};

export type DebtPardonPreview = {
  cutoffDate: string;
  entryCount: number;
  originalPenaltyTotal: string;
  paidTotal: string;
  pardonedTotal: string;
  snapshotHash: string;
  staff: DebtPardonStaffSummary[];
  staffCount: number;
};

export type DebtPardonResult = {
  auditWritten: number;
  detailsWritten: number;
  entryCount: number;
  id: string;
  originalPenaltyTotal: string;
  paidTotal: string;
  pardonedTotal: string;
  snapshotHash: string;
  staffCount: number;
};

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function dateText(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
}

// Unpaid balances on or before the cutoff that no earlier pardon already covers, for everyone or
// for one staff member.
function candidateCtes(cutoffDate: string, staffId?: string | null): SQL {
  const staffFilter = staffId ? sql`AND le.staff_id = ${staffId}::uuid` : sql``;
  return sql`
    allocation_totals AS (
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
      WHERE le.date <= ${cutoffDate}::date
        ${staffFilter}
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
    )
  `;
}

export async function previewLatenessDebtPardon(cutoffDate: string, staffId?: string | null): Promise<DebtPardonPreview> {
  const [snapshotResult, staffResult] = await Promise.all([
    db.execute(sql`WITH ${candidateCtes(cutoffDate, staffId)} SELECT * FROM snapshot`),
    db.execute(sql`
      WITH ${candidateCtes(cutoffDate, staffId)}
      SELECT
        c.staff_id::text AS staff_id,
        s.full_name,
        COALESCE(s.is_attendance_only, false) AS is_attendance_only,
        COUNT(*)::integer AS entry_count,
        MIN(c.entry_date)::text AS first_date,
        MAX(c.entry_date)::text AS last_date,
        SUM(c.penalty_amount)::numeric(12, 2) AS penalty_amount,
        SUM(c.paid_amount)::numeric(12, 2) AS paid_amount,
        SUM(c.forgiven_amount)::numeric(12, 2) AS forgiven_amount
      FROM candidates c
      JOIN staff s ON s.id = c.staff_id
      GROUP BY c.staff_id, s.full_name, s.is_attendance_only
      ORDER BY s.full_name
    `),
  ]);

  const snapshot = rowsOf(snapshotResult)[0] || {};
  return {
    cutoffDate,
    entryCount: Number(snapshot.entry_count || 0),
    originalPenaltyTotal: money(snapshot.penalty_total),
    paidTotal: money(snapshot.paid_total),
    pardonedTotal: money(snapshot.pardoned_total),
    snapshotHash: String(snapshot.snapshot_hash || ''),
    staff: rowsOf(staffResult).map((row) => ({
      entryCount: Number(row.entry_count || 0),
      firstDate: dateText(row.first_date),
      forgivenAmount: money(row.forgiven_amount),
      fullName: String(row.full_name || 'Unknown staff'),
      isAttendanceOnly: row.is_attendance_only === true,
      lastDate: dateText(row.last_date),
      paidAmount: money(row.paid_amount),
      penaltyAmount: money(row.penalty_amount),
      staffId: String(row.staff_id),
    })),
    staffCount: Number(snapshot.staff_count || 0),
  };
}

// Writes the pardon event, its per-entry ledger and its audit event in one statement, so either all
// of it is recorded or none of it is. Nothing is written if the debts changed since the reviewed
// preview (the snapshot hash no longer matches).
export async function applyLatenessDebtPardon(input: {
  actorEmail: string;
  actorUserId: string | null;
  cutoffDate: string;
  expectedSnapshotHash: string;
  reason: string;
  source: string;
  staffId?: string | null;
  staffName?: string | null;
}): Promise<DebtPardonResult | null> {
  const pardonId = randomUUID();
  const cutoffAt = new Date().toISOString();
  const staffId = input.staffId || null;
  const idempotencyKey = `${input.source}-${staffId || 'all'}-${input.cutoffDate}-${input.expectedSnapshotHash}`;

  const result = await db.execute(sql`
    WITH ${candidateCtes(input.cutoffDate, staffId)}, inserted_pardon AS (
      INSERT INTO lateness_debt_pardon (
        id, cutoff_at, cutoff_date, reason, actor_user_id, actor_email,
        idempotency_key, snapshot_hash, entry_count, staff_count,
        original_penalty_total, paid_total, pardoned_total
      )
      SELECT
        ${pardonId}::uuid, ${cutoffAt}::timestamptz, ${input.cutoffDate}::date, ${input.reason}::text,
        ${input.actorUserId}::text, ${input.actorEmail}::text, ${idempotencyKey}::text,
        snapshot.snapshot_hash, snapshot.entry_count, snapshot.staff_count,
        snapshot.penalty_total, snapshot.paid_total, snapshot.pardoned_total
      FROM snapshot
      WHERE snapshot.snapshot_hash = ${input.expectedSnapshotHash}::text
        AND snapshot.entry_count > 0
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
      INSERT INTO audit_event (entity_type, entity_id, action, before_json, after_json, actor_user_id, actor_email)
      SELECT
        'lateness_debt_pardon', inserted_pardon.id::text, 'CREATE', NULL,
        jsonb_build_object(
          'cutoffAt', ${cutoffAt}::timestamptz,
          'cutoffDate', ${input.cutoffDate}::date,
          'entryCount', inserted_pardon.entry_count,
          'staffCount', inserted_pardon.staff_count,
          'originalPenaltyTotal', inserted_pardon.original_penalty_total,
          'paidTotal', inserted_pardon.paid_total,
          'pardonedTotal', inserted_pardon.pardoned_total,
          'snapshotHash', inserted_pardon.snapshot_hash,
          'reason', ${input.reason}::text,
          'source', ${input.source}::text,
          'staffId', ${staffId}::text,
          'staffName', ${input.staffName || null}::text
        ),
        NULL, ${input.actorEmail}::text
      FROM inserted_pardon
      RETURNING id
    )
    SELECT
      inserted_pardon.id::text AS id,
      inserted_pardon.entry_count,
      inserted_pardon.staff_count,
      inserted_pardon.original_penalty_total,
      inserted_pardon.paid_total,
      inserted_pardon.pardoned_total,
      inserted_pardon.snapshot_hash,
      (SELECT COUNT(*)::integer FROM inserted_details) AS details_written,
      (SELECT COUNT(*)::integer FROM inserted_audit) AS audit_written
    FROM inserted_pardon
  `);

  const row = rowsOf(result)[0];
  if (!row) return null;

  return {
    auditWritten: Number(row.audit_written || 0),
    detailsWritten: Number(row.details_written || 0),
    entryCount: Number(row.entry_count || 0),
    id: String(row.id),
    originalPenaltyTotal: money(row.original_penalty_total),
    paidTotal: money(row.paid_total),
    pardonedTotal: money(row.pardoned_total),
    snapshotHash: String(row.snapshot_hash || ''),
    staffCount: Number(row.staff_count || 0),
  };
}
