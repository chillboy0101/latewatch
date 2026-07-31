/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// This rule used to be asserted against src/actions/staff.ts, a Server Action module that
// nothing imported. That module was deleted; the live implementation is the staff API route,
// so the rule is now asserted where it actually runs.
const staffApiPath = path.join(__dirname, '../src/app/api/staff/route.ts');

test('the staff API preserves the attendance monitoring only flag', () => {
  const source = fs.readFileSync(staffApiPath, 'utf8');

  assert.match(source, /const isAttendanceOnly = body\?\.isAttendanceOnly === true/);
  // Attendance-only staff are never also NSS personnel: the flag forces isNssPersonnel false.
  assert.match(source, /const isNssPersonnel = !isAttendanceOnly && body\?\.isNssPersonnel === true/);
  assert.match(source, /isAttendanceOnly,/);
  assert.match(source, /isNssPersonnel,/);
});
