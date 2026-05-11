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

test('attendance permission form uses free-text late reasons and selected absence reasons', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /ABSENCE_PERMISSION_REASONS/);
  assert.match(source, /permissionType === 'absence'\s*\?/);
  assert.match(source, /<option value="">Select absence reason<\/option>/);
  assert.match(source, /placeholder="Enter late arrival reason"/);
  assert.match(source, /formatAbsencePermissionReason\(permission\.reason\)/);
});

test('attendance permission form exposes absence date range and period controls', () => {
  const source = fs.readFileSync(attendancePagePath, 'utf8');

  assert.match(source, /permissionAbsenceEndDate/);
  assert.match(source, /permissionAbsenceWindow/);
  assert.match(source, /label="Absence Start"/);
  assert.match(source, /label="Absence End"/);
  assert.match(source, /label="Absence Period"/);
  assert.match(source, /absenceEndDate/);
});
