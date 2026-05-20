/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const checkInPagePath = path.join(__dirname, '../src/app/check-in/page.tsx');

test('check-in page uses compact location badge copy', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /Office location verified\. Accuracy/);
  assert.match(source, /distanceMeters: validation\.distanceMeters/);
  assert.match(source, /locationDistanceLabel\(liveLocation\.distanceMeters\)/);
  assert.match(source, /At office/);
  assert.match(source, /weak signal/);
  assert.match(source, /Not at office/);
});

test('check-in page keeps location blocking states intact', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /validation\.result === 'LOCATION_ACCURACY_WEAK'/);
  assert.match(source, /state: 'weak'/);
  assert.match(source, /state: 'outside'/);
  assert.match(source, /locationBlocksAction/);
  assert.match(source, /Improve GPS Accuracy/);
});

test('check-in page uses concise attendance status copy', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /your late check-in has been recorded/);
  assert.doesNotMatch(source, /you are checked in for today/);
  assert.doesNotMatch(source, /you have checked out for today/);
  assert.doesNotMatch(source, /You can check in now/);
  assert.doesNotMatch(source, /statusDetailText &&/);
  assert.match(source, /No sign-out recorded/);
  assert.match(source, /Late \+ no sign-out recorded/);
  assert.match(source, /hasNoSignOutPenalty/);
  assert.match(source, /hasLateCheckInPenalty/);
});

test('check-in page auto-dismisses response feedback', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /CHECK_IN_FEEDBACK_DISMISS_MS = 4_000/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /setMessage\(null\);/);
  assert.match(source, /window\.clearTimeout\(timeout\)/);
});
