import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const OVERPAID_ENTRY_ID = 'd1e57c76-4b23-4659-a0c8-98e22a4bc48e'; // 2026-05-20, penalty now 10.00, allocated 12.00
const UNDERPAID_ENTRY_ID_QUERY = { date: '2026-06-23', staffId: 'ddc54159-43b7-4b59-a097-1a2bd201a1c3' };
const STRANDED_AMOUNT = '2.00';
const INVALIDATION_CHANNELS = ['payments', 'entries', 'dashboard', 'audit-trail', 'staff-penalty-history'];

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/repair-regina-allotey-stranded-overpayment.mjs -- [--apply]');
  console.log('Regina Allotey\'s 2026-05-20 lateness entry was paid GHC 12.00 before its penalty was');
  console.log('recalculated down to GHC 10.00 (NSS flat-rate correction). The excess GHC 2.00 became a');
  console.log('stranded overpayment that the paid/unpaid summary silently clips away. She has an unpaid');
  console.log('GHC 2.00 entry from 2026-06-23 - this moves the stranded 2.00 there. No new cash moves;');
  console.log('this is a bookkeeping correction of an existing allocation.');
  console.log('Runs a dry-run by default. Add --apply to write the change.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

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
      reason: 'repair-regina-allotey-stranded-overpayment',
    }),
  ));
  return true;
}

const overpaidEntry = await sql`SELECT * FROM lateness_entry WHERE id = ${OVERPAID_ENTRY_ID}`;
const overpaidAllocations = await sql`SELECT * FROM lateness_payment_allocation WHERE entry_id = ${OVERPAID_ENTRY_ID}`;
const underpaidEntryRows = await sql`
  SELECT * FROM lateness_entry WHERE staff_id = ${UNDERPAID_ENTRY_ID_QUERY.staffId} AND date = ${UNDERPAID_ENTRY_ID_QUERY.date}
`;

if (overpaidEntry.length === 0 || overpaidAllocations.length !== 1 || underpaidEntryRows.length !== 1) {
  console.error('Expected data shape not found - aborting without making changes.');
  console.error({ overpaidEntry, overpaidAllocations, underpaidEntryRows });
  process.exit(1);
}

const allocation = overpaidAllocations[0];
const underpaidEntry = underpaidEntryRows[0];

if (allocation.allocated_amount !== '12.00' || overpaidEntry[0].computed_amount !== '10.00') {
  console.error('Allocation/entry amounts do not match expected pre-repair state - aborting.');
  console.error({ allocation, overpaidEntry });
  process.exit(1);
}

console.log('Overpaid entry (2026-05-20):', { computedAmount: overpaidEntry[0].computed_amount, allocatedAmount: allocation.allocated_amount });
console.log('Underpaid entry (2026-06-23):', { computedAmount: underpaidEntry.computed_amount, id: underpaidEntry.id });
console.log(`\nPlanned change: reduce allocation ${allocation.id} from 12.00 to 10.00, and add a new ${STRANDED_AMOUNT} allocation against entry ${underpaidEntry.id} using the same payment (${allocation.payment_id}).`);

if (!applyChanges) {
  console.log('\nDry run only - no changes made. Re-run with --apply to write this.');
  process.exit(0);
}

const before = { overpaidAllocation: allocation, underpaidEntryAllocations: await sql`SELECT * FROM lateness_payment_allocation WHERE entry_id = ${underpaidEntry.id}` };

await sql`UPDATE lateness_payment_allocation SET allocated_amount = '10.00' WHERE id = ${allocation.id}`;
const [newAllocation] = await sql`
  INSERT INTO lateness_payment_allocation (payment_id, entry_id, allocated_amount)
  VALUES (${allocation.payment_id}, ${underpaidEntry.id}, ${STRANDED_AMOUNT})
  RETURNING *
`;

console.log('\nUpdated allocation:', allocation.id, '-> 10.00');
console.log('Created new allocation:', newAllocation);

await writeAuditEvent({
  action: 'UPDATE',
  after: { newAllocation, updatedAllocation: { ...allocation, allocated_amount: '10.00' } },
  before,
  entityId: OVERPAID_ENTRY_ID,
  entityType: 'lateness_payment_allocation',
});

const published = await publishInvalidation();
console.log(published ? 'Published realtime invalidation.' : 'ABLY_API_KEY not set - skipped realtime invalidation.');

console.log('\nDone.');
