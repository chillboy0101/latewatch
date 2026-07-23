import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('tsx/cjs');

const {
  NO_SHOW_SIGN_IN_AMOUNT,
  NO_SHOW_SIGN_IN_REASON,
} = require('../src/lib/penalty-calculator.ts');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const PREVIOUS_AMOUNT = '50.00';
const CORRECTED_AMOUNT = NO_SHOW_SIGN_IN_AMOUNT.toFixed(2);
const CORRECTION_REASON = 'no-show-sign-in-amount-correction-50-to-10';
const INVALIDATION_CHANNELS = [
  'entries',
  'attendance',
  'payments',
  'dashboard',
  'audit-trail',
  'notifications',
];

if (process.argv.includes('--help')) {
  console.log('Usage: npm run no-show:correct-amount -- [--apply]');
  console.log(`Corrects billed no-show sign-in penalties from GHC ${PREVIOUS_AMOUNT} to GHC ${CORRECTED_AMOUNT}.`);
  console.log('Waived entries (GHC 0.00) are never touched. Runs a dry-run by default; add --apply to write.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

if (CORRECTED_AMOUNT === PREVIOUS_AMOUNT) {
  console.error(`NO_SHOW_SIGN_IN_AMOUNT is still ${CORRECTED_AMOUNT}; update src/lib/penalty-calculator.ts first.`);
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function toDateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

async function writeAuditEvent({ action, after, before, entityId, entityType }) {
  await sql`
    insert into audit_event (
      entity_type,
      entity_id,
      action,
      before_json,
      after_json,
      actor_user_id,
      actor_email
    ) values (
      ${entityType},
      ${entityId},
      ${action},
      ${before ? JSON.stringify(before) : null}::jsonb,
      ${after ? JSON.stringify(after) : null}::jsonb,
      null,
      'system'
    )
  `;
}

async function publishInvalidation() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return false;

  const client = new Rest({ key });
  await Promise.all(INVALIDATION_CHANNELS.map((channel) =>
    client.channels.get(`latewatch:${channel}`).publish('invalidate', {
      reason: CORRECTION_REASON,
    })
  ));
  return true;
}

async function fetchBilledEntries() {
  return sql`
    select
      le.id,
      le.staff_id as "staffId",
      s.full_name as "staffName",
      le.date,
      le.computed_amount as "computedAmount",
      le.override_amount as "overrideAmount",
      le.reason
    from lateness_entry le
    left join staff s on s.id = le.staff_id
    where
      le.reason = ${NO_SHOW_SIGN_IN_REASON}
      and le.computed_amount = ${PREVIOUS_AMOUNT}
    order by le.date asc, s.full_name asc
  `;
}

async function fetchAllocationsForEntries(entryIds) {
  if (entryIds.length === 0) return [];

  return sql`
    select
      id,
      entry_id as "entryId",
      payment_id as "paymentId",
      allocated_amount as "allocatedAmount"
    from lateness_payment_allocation
    where entry_id = any(${entryIds})
  `;
}

console.log(`${applyChanges ? 'Applying' : 'Dry run'} no-show sign-in amount correction (GHC ${PREVIOUS_AMOUNT} -> GHC ${CORRECTED_AMOUNT})...`);

const entries = await fetchBilledEntries();
console.log(`Billed GHC ${PREVIOUS_AMOUNT} no-show entries found: ${entries.length}`);

if (entries.length === 0) {
  console.log('Nothing to correct.');
  process.exit(0);
}

const allocations = await fetchAllocationsForEntries(entries.map((entry) => entry.id));
const allocatedEntryIds = new Set(allocations.map((allocation) => allocation.entryId));

const correctable = entries.filter((entry) => !allocatedEntryIds.has(entry.id) && entry.overrideAmount === null);
const blocked = entries.filter((entry) => allocatedEntryIds.has(entry.id) || entry.overrideAmount !== null);

console.log('');
console.log(`Entries safe to correct (no payments, no manual override): ${correctable.length}`);
for (const entry of correctable) {
  console.log(`- ${entry.staffName || entry.staffId}: ${toDateKey(entry.date)} — GHC ${PREVIOUS_AMOUNT} -> GHC ${CORRECTED_AMOUNT} [entryId=${entry.id}]`);
}

if (blocked.length > 0) {
  console.log('');
  console.log(`Entries with a payment allocation or manual override — NOT auto-corrected, needs manual review: ${blocked.length}`);
  for (const entry of blocked) {
    const flags = [
      allocatedEntryIds.has(entry.id) ? 'payment allocation' : null,
      entry.overrideAmount !== null ? `override ${entry.overrideAmount}` : null,
    ].filter(Boolean).join(', ');
    console.log(`- ${entry.staffName || entry.staffId}: ${toDateKey(entry.date)} — GHC ${entry.computedAmount} (${flags}) [entryId=${entry.id}]`);
  }
}

if (!applyChanges) {
  console.log('');
  console.log('No records were changed. Run with --apply to correct these entries.');
} else {
  for (const entry of correctable) {
    await sql`
      update lateness_entry
      set computed_amount = ${CORRECTED_AMOUNT}, updated_at = now()
      where id = ${entry.id} and computed_amount = ${PREVIOUS_AMOUNT}
    `;

    await writeAuditEvent({
      action: 'UPDATE',
      after: { computedAmount: CORRECTED_AMOUNT, correction: CORRECTION_REASON },
      before: { computedAmount: PREVIOUS_AMOUNT, reason: entry.reason },
      entityId: entry.id,
      entityType: 'lateness_entry',
    });
  }

  console.log('');
  console.log(`Corrected ${correctable.length} no-show sign-in entries to GHC ${CORRECTED_AMOUNT}.`);
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, payments, dashboard, audit trail, and notifications.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
