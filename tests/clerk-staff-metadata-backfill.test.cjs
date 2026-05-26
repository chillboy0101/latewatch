/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scriptSource = fs.readFileSync(path.join(root, 'scripts', 'sync-clerk-staff-metadata.mjs'), 'utf8');

test('Clerk staff metadata backfill is exposed as a dry-run-first script', () => {
  assert.equal(packageJson.scripts['clerk:staff-metadata'], 'node scripts/sync-clerk-staff-metadata.mjs');
  assert.match(scriptSource, /--apply/);
  assert.match(scriptSource, /Dry run/);
});

test('Clerk staff metadata backfill updates existing users without creating invitations', () => {
  assert.match(scriptSource, /getUserList/);
  assert.match(scriptSource, /updateUserMetadata/);
  assert.doesNotMatch(scriptSource, /createOrganizationInvitation/);
});
