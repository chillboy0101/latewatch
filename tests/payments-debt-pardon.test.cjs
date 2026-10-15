/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('debt pardon API is admin-only and only applies a reviewed preview', () => {
  const route = read('src', 'app', 'api', 'payments', 'debt-pardon', 'route.ts');

  assert.equal((route.match(/enforceRole\(\['admin'\]\)/g) || []).length, 2);
  // Pardons cover finished days only (up to yesterday), so 8 PM no-sign-out fees can't be skipped.
  assert.match(route, /if \(cutoffDate > yesterday\) return \{ error: 'Pardons can cover days up to yesterday/);
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

  assert.match(page, /Pardon debts/);
  assert.match(page, /\/api\/payments\/debt-pardon\?\$\{query\}/);
  assert.match(page, /expectedSnapshotHash: debtPardonPreview\.snapshotHash/);
  assert.match(page, /if \(!debtPardonConfirmed\) \{\s*setDebtPardonConfirmed\(true\);\s*return;/);
  assert.match(page, /Tap again to confirm/);
  assert.doesNotMatch(page, /I confirm that/);
});

test('audit trail describes debt pardons', () => {
  const taxonomy = read('src', 'lib', 'audit-taxonomy.ts');
  const auditPage = read('src', 'app', 'audit-trail', 'page.tsx');

  assert.match(taxonomy, /lateness_debt_pardon: 'Lateness Debt Pardon'/);
  assert.match(auditPage, /describeDebtPardon\('Pardoned', afterData\)/);
});

test('debts can be pardoned for one staff member as well as everyone', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const engine = read('src', 'lib', 'lateness-debt-pardon.ts');
  const route = read('src', 'app', 'api', 'payments', 'debt-pardon', 'route.ts');
  const page = read('src', 'app', 'payments', 'page.tsx');

  assert.match(engine, /const staffFilter = staffId \? sql`AND le\.staff_id = \$\{staffId\}::uuid` : sql``;/);
  assert.match(engine, /\$\{input\.source\}-\$\{staffId \|\| 'all'\}-\$\{input\.cutoffDate\}/);
  assert.match(engine, /'staffName', \$\{input\.staffName \|\| null\}::text/);
  assert.match(route, /async function resolveStaff\(value: unknown\)/);
  assert.match(route, /previewLatenessDebtPardon\(resolved\.cutoffDate, target\.staffId\)/);
  assert.match(route, /staffId: target\.staffId,/);
  assert.match(page, /<StaffPicker\n\s+label="Who"\n\s+allLabel="Everyone"/);
  assert.match(page, /openDebtPardonDialog\(selectedRow\.id\)/);
  assert.match(page, /staffId: debtPardonStaffId \|\| undefined/);
});
