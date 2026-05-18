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
