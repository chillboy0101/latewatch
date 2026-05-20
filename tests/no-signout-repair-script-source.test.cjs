/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('no-sign-out waiver repair script is dry-run first and available through npm', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scriptPath = path.join(root, 'scripts', 'repair-no-signout-waivers.mjs');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.equal(packageJson.scripts['no-signout:repair-waivers'], 'node scripts/repair-no-signout-waivers.mjs');
  assert.match(source, /process\.argv\.includes\('--apply'\)/);
  assert.match(source, /legacy fake sign-outs found/i);
  assert.match(source, /audit-confirmed cleared no-sign-out rows found/i);
  assert.match(source, /already waived charged rows to clean/i);
  assert.match(source, /ambiguous rows skipped/i);
  assert.match(source, /after_json->>'reason'[\s\S]*not ilike '%DID NOT SIGN OUT%'/);
  assert.match(source, /Run with --apply/);
});
