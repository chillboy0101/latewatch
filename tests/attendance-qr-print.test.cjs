/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const attendancePagePath = path.join(__dirname, '../src/app/attendance/page.tsx');

test('attendance QR print sheet does not show the raw install URL text', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /Scan to install LateWatch or open attendance\./);
  assert.doesNotMatch(source, /<p class="url">\$\{qrData\.checkInUrl\}<\/p>/);
});

test('late arrival permissions use the approved reason select list', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /LATE_ARRIVAL_PERMISSION_REASONS/);
  assert.match(source, /permissionType === 'late_arrival'\s*\?/);
  assert.match(source, /<option value="">Select reason<\/option>/);
  assert.match(source, /formatLateArrivalPermissionReason\(permission\.reason\)/);
});
