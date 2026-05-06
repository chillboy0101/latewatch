/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staffActionsPath = path.join(__dirname, '../src/actions/staff.ts');

test('legacy staff actions preserve the attendance monitoring only flag', () => {
  const source = fs.readFileSync(staffActionsPath, 'utf8');

  assert.match(source, /isAttendanceOnly\?: boolean/);
  assert.match(source, /isAttendanceOnly: data\.isAttendanceOnly === true/);
  assert.match(source, /isNssPersonnel: data\.isAttendanceOnly === true \? false : data\.isNssPersonnel === true/);
});
