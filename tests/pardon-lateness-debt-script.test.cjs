/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const script = fs.readFileSync(
  path.join(__dirname, '../scripts/pardon-lateness-debt.mjs'),
  'utf8',
);

test('lateness debt pardon accepts an explicit valid Accra cutoff date', () => {
  assert.match(script, /--cutoff-date YYYY-MM-DD/);
  assert.match(script, /const cutoffDate = requestedCutoffDate \|\| todayDate/);
  assert.match(script, /if \(!isValidDateKey\(cutoffDate\)\)/);
  assert.match(script, /if \(cutoffDate > todayDate\)/);
  assert.match(script, /le\.date <= \$1::date/);
  assert.match(script, /le\.date <= \$3::date/);
});
