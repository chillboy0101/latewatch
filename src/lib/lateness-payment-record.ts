import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export type PlannedAllocation = {
  amount: string;
  entryId: string;
  expectedForgiven: string;
  expectedPaid: string;
  expectedPenalty: string;
};

// Records the payment and its allocations in one transaction. A per-staff lock makes a second
// submit wait for the first, and nothing is written unless every entry still has the penalty,
// payments and pardons the allocation was planned from, so a double-click or two admins paying
// at once can never pay the same debt twice. Returns null when nothing was written.
export async function recordPaymentAtomically(input: {
  allocations: PlannedAllocation[];
  amount: string;
  note: string | null;
  recordedByEmail: string;
  recordedByUserId: string;
  staffId: string;
  weekEnd: string;
  weekStart: string;
}) {
  if (input.allocations.length === 0) return null;
  const paymentId = randomUUID();
  const plan = sql.join(input.allocations.map((allocation) => sql`(
    ${allocation.entryId}::uuid, ${allocation.amount}::numeric,
    ${allocation.expectedPenalty}::numeric, ${allocation.expectedPaid}::numeric, ${allocation.expectedForgiven}::numeric
  )`), sql`, `);

  const [, result] = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lateness-payment:${input.staffId}`}))`),
    db.execute(sql`
      WITH plan (entry_id, amount, expected_penalty, expected_paid, expected_forgiven) AS (VALUES ${plan}),
      current_state AS (
        SELECT
          plan.entry_id,
          le.computed_amount AS penalty,
          COALESCE((SELECT SUM(a.allocated_amount) FROM lateness_payment_allocation a WHERE a.entry_id = plan.entry_id), 0) AS paid,
          COALESCE((SELECT SUM(p.forgiven_amount) FROM lateness_debt_pardon_entry p WHERE p.entry_id = plan.entry_id), 0) AS forgiven
        FROM plan
        JOIN lateness_entry le ON le.id = plan.entry_id AND le.staff_id = ${input.staffId}::uuid
      ),
      unchanged AS (
        SELECT
          COUNT(*) = ${input.allocations.length}
          AND COALESCE(BOOL_AND(
            c.penalty = plan.expected_penalty AND c.paid = plan.expected_paid AND c.forgiven = plan.expected_forgiven
          ), false) AS ok
        FROM plan
        JOIN current_state c ON c.entry_id = plan.entry_id
      ),
      inserted_payment AS (
        INSERT INTO lateness_payment (id, staff_id, amount, week_start, week_end, note, recorded_by_user_id, recorded_by_email)
        SELECT
          ${paymentId}::uuid, ${input.staffId}::uuid, ${input.amount}::numeric, ${input.weekStart}::date, ${input.weekEnd}::date,
          ${input.note}::text, ${input.recordedByUserId}::text, ${input.recordedByEmail}::text
        FROM unchanged
        WHERE unchanged.ok
        RETURNING id
      ),
      inserted_allocations AS (
        INSERT INTO lateness_payment_allocation (payment_id, entry_id, allocated_amount)
        SELECT inserted_payment.id, plan.entry_id, plan.amount
        FROM inserted_payment
        CROSS JOIN plan
        RETURNING id
      )
      SELECT inserted_payment.id::text AS id, (SELECT COUNT(*)::integer FROM inserted_allocations) AS allocations_written
      FROM inserted_payment
    `),
  ]);

  const row = (result as { rows?: Array<{ id?: string }> }).rows?.[0];
  return row?.id ? String(row.id) : null;
}
