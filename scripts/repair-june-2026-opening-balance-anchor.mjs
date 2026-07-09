import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const TARGET_MONTH_KEY = '2026-06-01';
const INVALIDATION_CHANNELS = ['payments', 'dashboard', 'audit-trail'];

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/repair-june-2026-opening-balance-anchor.mjs -- [--apply]');
  console.log('Deletes the stray manual opening_balance anchor saved for June 2026.');
  console.log('May 2026 is the ledger\'s true starting anchor; every later month must auto-carry');
  console.log('the previous month\'s live closing balance. June\'s own frozen anchor (saved under');
  console.log('the old workflow) breaks that guarantee - if May\'s closing ever changes, June would');
  console.log('silently stop tracking it. Removing it restores auto-carry with no change in today\'s numbers.');
  console.log('Runs a dry-run by default. Add --apply to delete the row.');
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
      reason: 'repair-june-2026-opening-balance-anchor',
    }),
  ));
  return true;
}

const rows = await sql`
  SELECT id, month_key AS "monthKey", item_type AS "itemType", amount, label, updated_by_email AS "updatedBy", updated_at AS "updatedAt"
  FROM offence_book_item
  WHERE item_type = 'opening_balance' AND month_key = ${TARGET_MONTH_KEY}
`;

if (rows.length === 0) {
  console.log('No opening_balance row found for June 2026. Nothing to do.');
  process.exit(0);
}

console.log(`Found ${rows.length} opening_balance row(s) for June 2026:`);
console.table(rows);

if (!applyChanges) {
  console.log('\nDry run only - no changes made. Re-run with --apply to delete this row.');
  process.exit(0);
}

const ids = rows.map((row) => row.id);
await sql`DELETE FROM offence_book_item WHERE id = ANY(${ids})`;
console.log(`Deleted ${ids.length} row(s).`);

await writeAuditEvent({
  action: 'DELETE',
  after: null,
  before: rows,
  entityId: TARGET_MONTH_KEY,
  entityType: 'offence_book_item',
});

const published = await publishInvalidation();
console.log(published ? 'Published realtime invalidation.' : 'ABLY_API_KEY not set - skipped realtime invalidation.');

console.log('\nDone. June 2026 will now auto-carry its opening balance from May 2026\'s live closing balance.');
