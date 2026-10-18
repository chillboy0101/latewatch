/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// This rule used to be asserted against src/actions/staff.ts, a Server Action module that
// nothing imported. That module was deleted; the live implementation is the staff API route,
// so the rule is now asserted where it actually runs.
const staffApiPath = path.join(__dirname, '../src/app/api/staff/route.ts');

test('the staff API saves one type and keeps the two charge flags in step with it', () => {
  const source = fs.readFileSync(staffApiPath, 'utf8');

  // Intern, NSS, special staff or main; older clients sending the flags still work.
  assert.match(source, /const staffType: StaffType = isStaffType\(body\?\.staffType\)/);
  assert.match(source, /: body\?\.isAttendanceOnly === true \? 'special' : body\?\.isNssPersonnel === true \? 'nss' : 'main';/);
  assert.match(source, /const \{ isAttendanceOnly, isNssPersonnel \} = flagsForStaffType\(staffType\);/);
  assert.match(source, /staffType,\n\s+active: true,/);
})
