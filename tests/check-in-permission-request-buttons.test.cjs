/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const checkInPagePath = path.join(__dirname, '../src/app/check-in/page.tsx');

function functionBlock(source, name) {
  const match = source.match(new RegExp(`async function ${name}\\(\\)[\\s\\S]*?\\n  }`));
  assert.ok(match, `${name} block should exist`);
  return match[0];
}

test('check-in permission request buttons are gated to Anna-Lisa', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /function isAnnalisaPermissionRequestStaff/);
  assert.match(source, /name\.includes\('annalisa'\) && name\.includes\('hammond'\)/);
  assert.match(source, /const showAnnalisaPermissionRequests = isAnnalisaPermissionRequestStaff\(status\?\.staff \|\| null\)/);
  assert.match(source, /\{showAnnalisaPermissionRequests && \(/);
  assert.match(source, /Request location access/);
  assert.match(source, /Request notification access/);
});

test('Anna-Lisa location permission button requests live device location only', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  const block = functionBlock(source, 'requestLocationAccess');

  assert.match(block, /await getCurrentLocationEvidence\(\)/);
  assert.match(block, /setLiveLocation\(nextLiveLocation\)/);
  assert.match(block, /locationErrorMessage\(error\)/);
  assert.doesNotMatch(block, /fetch\('\/api\/attendance\/check-in'/);
  assert.doesNotMatch(block, /submitAttendance/);
});

test('Anna-Lisa notification permission button requests browser permission only', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  const block = functionBlock(source, 'requestNotificationAccess');

  assert.match(block, /await Notification\.requestPermission\(\)/);
  assert.match(block, /setNotificationPermission\(permission\)/);
  assert.match(block, /site notification permission in iOS\/browser settings/);
  assert.doesNotMatch(block, /\/api\/attendance\/check-in\/push-subscription/);
  assert.doesNotMatch(block, /navigator\.serviceWorker/);
  assert.doesNotMatch(block, /pushManager/);
  assert.doesNotMatch(block, /showReminderToggleConfirmation/);
});
