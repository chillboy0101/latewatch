import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('tsx/cjs');

const {
  NO_SHOW_SIGN_IN_EFFECTIVE_DATE,
  NO_SHOW_SIGN_IN_REASON,
  NO_SHOW_SIGN_IN_WAIVED_REASON,
} = require('../src/lib/penalty-calculator.ts');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const REPAIR_REASON = 'retroactive-no-show-sign-in-penalty-correction';
const INVALIDATION_CHANNELS = [
  'entries',
  'attendance',
  'payments',
  'dashboard',
  'audit-trail',
  'notifications',
];

if (process.argv.includes('--help')) {
  console.log('Usage: npm run attendance:repair-retroactive-no-show -- [--apply]');
  console.log('Runs a dry-run by default. Add --apply to delete the erroneous entries.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function toDateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function amountText(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
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
      reason: REPAIR_REASON,
    })
  ));
  return true;
}

async function fetchRetroactiveEntries() {
  return sql`
    select
      le.id,
      le.staff_id as "staffId",
      s.full_name as "staffName",
      le.date,
      le.arrival_time as "arrivalTime",
      le.did_not_sign_out as "didNotSignOut",
      le.computed_amount as "computedAmount",
      le.reason
    from lateness_entry le
    left join staff s on s.id = le.staff_id
    where
      le.reason in (${NO_SHOW_SIGN_IN_REASON}, ${NO_SHOW_SIGN_IN_WAIVED_REASON})
      and le.date < ${NO_SHOW_SIGN_IN_EFFECTIVE_DATE}
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

async function deleteEntry(entry) {
  await sql`delete from lateness_entry where id = ${entry.id}`;

  await writeAuditEvent({
    action: 'DELETE',
    after: null,
    before: {
      arrivalTime: entry.arrivalTime,
      computedAmount: entry.computedAmount,
      date: toDateKey(entry.date),
      didNotSignOut: entry.didNotSignOut,
      id: entry.id,
      reason: entry.reason,
      repairReason: REPAIR_REASON,
      staffId: entry.staffId,
    },
    entityId: entry.id,
    entityType: 'entry',
  });
}

console.log(`${applyChanges ? 'Applying' : 'Dry run'} retroactive no-show sign-in penalty correction...`);
console.log(`Rule effective date: ${NO_SHOW_SIGN_IN_EFFECTIVE_DATE} (entries before this date are being corrected)`);

const entries = await fetchRetroactiveEntries();
console.log(`Retroactive no-show entries found: ${entries.length}`);

if (entries.length === 0) {
  console.log('Nothing to correct.');
  process.exit(0);
}

const allocations = await fetchAllocationsForEntries(entries.map((entry) => entry.id));
const allocationsByEntryId = new Map();
for (const allocation of allocations) {
  const list = allocationsByEntryId.get(allocation.entryId) || [];
  list.push(allocation);
  allocationsByEntryId.set(allocation.entryId, list);
}

const deletable = entries.filter((entry) => !allocationsByEntryId.has(entry.id));
const blocked = entries.filter((entry) => allocationsByEntryId.has(entry.id));

console.log('');
console.log(`Entries safe to delete (no payments recorded against them): ${deletable.length}`);
for (const entry of deletable) {
  console.log(`- ${entry.staffName || entry.staffId}: ${toDateKey(entry.date)} — GHC ${amountText(entry.computedAmount)} (${entry.reason})`);
}

if (blocked.length > 0) {
  console.log('');
  console.log(`Entries with an existing payment allocation — NOT auto-deleted, needs manual review: ${blocked.length}`);
  for (const entry of blocked) {
    const entryAllocations = allocationsByEntryId.get(entry.id) || [];
    console.log(`- ${entry.staffName || entry.staffId}: ${toDateKey(entry.date)} — GHC ${amountText(entry.computedAmount)} (${entry.reason}), ${entryAllocations.length} payment allocation(s) [entryId=${entry.id}]`);
  }
}

const totalAmount = deletable.reduce((sum, entry) => sum + Number(entry.computedAmount || 0), 0);
console.log('');
console.log(`Staff affected: ${new Set(deletable.map((entry) => entry.staffId)).size}`);
console.log(`Total amount to reverse: GHC ${totalAmount.toFixed(2)}`);

if (!applyChanges) {
  console.log('');
  console.log('No records were changed. Run with --apply to delete these erroneous entries.');
} else {
  for (const entry of deletable) {
    await deleteEntry(entry);
  }

  await writeAuditEvent({
    action: 'SYNC',
    after: {
      blockedCount: blocked.length,
      deletedCount: deletable.length,
      effectiveDate: NO_SHOW_SIGN_IN_EFFECTIVE_DATE,
      totalAmountReversed: totalAmount.toFixed(2),
    },
    before: null,
    entityId: REPAIR_REASON,
    entityType: 'system',
  });

  console.log('');
  console.log(`Deleted ${deletable.length} erroneous no-show sign-in entries.`);
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, payments, dashboard, audit trail, and notifications.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
