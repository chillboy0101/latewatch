/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const entriesPagePath = path.join(__dirname, '../src/app/entries/page.tsx');
const recalculateScriptPath = path.join(__dirname, '../scripts/recalculate-regular-staff-penalties.mjs');

test('entries page live penalty calculation preserves monitoring-only staff rules', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly\?: boolean \| null/);
  assert.match(source, /isAttendanceOnly: member\?\.isAttendanceOnly === true/);
});

test('regular staff recalculation apply notifies live pages to refetch entries', () => {
  const source = fs.readFileSync(recalculateScriptPath, 'utf8');

  assert.match(source, /async function publishInvalidation/);
  assert.match(source, /latewatch:\$\{channel\}/);
  assert.match(source, /'entries'/);
  assert.match(source, /'attendance'/);
  assert.match(source, /'dashboard'/);
});
