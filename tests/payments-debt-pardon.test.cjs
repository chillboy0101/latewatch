/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('debt pardon API is admin-only and only applies a reviewed preview', () => {
  const route = read('src', 'app', 'api', 'payments', 'debt-pardon', 'route.ts');

  assert.equal((route.match(/enforceRole\(\['admin'\]\)/g) || []).length, 2);
  assert.match(route, /The cutoff date cannot be in the future/);
  assert.match(route, /Preview the pardon before applying it/);
  assert.match(route, /A reason for the pardon is required/);
  assert.match(route, /status: 409/);
  assert.match(route, /result\.detailsWritten !== result\.entryCount \|\| result\.auditWritten !== 1/);
});

test('debt pardon writes event, ledger and audit atomically and never re-pardons', () => {
  const lib = read('src', 'lib', 'lateness-debt-pardon.ts');

  assert.match(lib, /WHERE le\.date <= \$\{cutoffDate\}::date/);
  assert.match(lib, /NOT EXISTS \(\s*SELECT 1 FROM lateness_debt_pardon_entry p WHERE p\.entry_id = le\.id\s*\)/);
  assert.match(lib, /WHERE snapshot\.snapshot_hash = \$\{input\.expectedSnapshotHash\}::text\s*AND snapshot\.entry_count > 0/);
  assert.match(lib, /INSERT INTO lateness_debt_pardon_entry/);
  assert.match(lib, /INSERT INTO audit_event/);
});

test('payments page offers a previewed, confirmed pardon-all action', () => {
  const page = read('src', 'app', 'payments', 'page.tsx');

  assert.match(page, /Pardon all/);
  assert.match(page, /\/api\/payments\/debt-pardon\?cutoffDate=/);
  assert.match(page, /expectedSnapshotHash: debtPardonPreview\.snapshotHash/);
  assert.match(page, /!debtPardonConfirmed/);
});

test('audit trail describes debt pardons', () => {
  const taxonomy = read('src', 'lib', 'audit-taxonomy.ts');
  const auditPage = read('src', 'app', 'audit-trail', 'page.tsx');

  assert.match(taxonomy, /lateness_debt_pardon: 'Lateness Debt Pardon'/);
  assert.match(auditPage, /describeDebtPardon\('Pardoned', afterData\)/);
});
