/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const checkInPagePath = path.join(process.cwd(), 'src', 'app', 'check-in', 'page.tsx');

test('check-in page does not raise Next dev overlay for handled attendance failures', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /console\.error\(/);
  assert.match(source, /console\.warn\('Attendance action could not complete:'/);
  assert.match(source, /console\.warn\('Device transfer request could not complete:'/);
});
