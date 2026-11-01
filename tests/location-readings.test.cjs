/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { CLEAR_READING_WAIT_MS, pickReading, rememberReading } = require('../src/lib/location-readings.ts');

const now = Date.UTC(2026, 9, 15, 8, 0, 0);
const reading = (secondsAgo, accuracy, latitude = 5.5658) => ({
  accuracy,
  latitude,
  longitude: -0.1775,
  timestamp: new Date(now - secondsAgo * 1000).toISOString(),
});

test('check-in uses the clear reading the phone already has', () => {
  // Latest clear: use it (someone arriving is judged where they are now).
  assert.equal(pickReading([reading(15, 5, 1), reading(2, 12, 2)], now).latitude, 2);
  // Latest vague: the newest clear one from the last 20 s still counts.
  assert.equal(pickReading([reading(18, 6, 1), reading(9, 8, 2), reading(1, 60, 3)], now).latitude, 2);
  // Nothing clear: the least vague recent one.
  assert.equal(pickReading([reading(10, 45, 1), reading(3, 30, 2), reading(1, 80, 3)], now).latitude, 2);
  // Too old (over 20 s) or from the future: none.
  assert.equal(pickReading([reading(25, 5)], now), null);
  assert.equal(pickReading([reading(-30, 5)], now), null);
  assert.equal(pickReading([], now), null);
});

test('readings are kept once, in order, for a minute', () => {
  const readings = [];
  rememberReading(readings, reading(5, 10, 1), now);
  rememberReading(readings, reading(30, 10, 2), now);
  rememberReading(readings, reading(5, 10, 1), now);
  rememberReading(readings, reading(90, 10, 3), now);
  assert.deepEqual(readings.map((item) => item.latitude), [2, 1]);
  for (let index = 0; index < 50; index += 1) rememberReading(readings, reading(index / 2, 10), now);
  assert.equal(readings.length, 40);
  rememberReading(readings, { ...reading(1, 10), timestamp: 'not a time' }, now);
  assert.equal(readings.length, 40);
});

test('the check-in screen sends the best reading and only waits when every reading is vague', () => {
  assert.equal(CLEAR_READING_WAIT_MS, 2_000);
  const page = read('src', 'app', 'check-in', 'page.tsx');
  // Check-in waits for a reading; a device transfer request goes even without one.
  assert.equal(page.match(/const location = await locationForAction\(readingsRef\.current\);/g).length, 1);
  assert.equal(page.match(/const location = pickReading\(readingsRef\.current\) \?\? null;/g).length, 1);
  assert.match(page, /if \(ready && ready\.accuracy <= CLEAR_READING_METERS\) return ready;/);
  assert.match(page, /setLiveLocation\(validateLiveLocation\(locationPolicy, pickReading\(readingsRef\.current\) \|\| evidence\)\);/);
});
