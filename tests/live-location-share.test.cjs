/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { parseTraceReading } = require('../src/lib/location-trace.ts');

const now = Date.UTC(2026, 9, 15, 9, 0, 0);
const good = { accuracy: 4.567, latitude: 5.56582934, longitude: -0.17752821, note: '  front-left corner  ', timestamp: now - 5_000 };

test('a live reading is kept with its spot note, rounded to what the table stores', () => {
  const reading = parseTraceReading(good, now);
  assert.equal(reading.accuracy, 4.57);
  assert.equal(reading.latitude, 5.5658293);
  assert.equal(reading.longitude, -0.1775282);
  assert.equal(reading.note, 'front-left corner');
  assert.equal(reading.capturedAt.getTime(), now - 5_000);
  assert.equal(parseTraceReading({ ...good, note: 'x'.repeat(80) }, now).note.length, 60);
  assert.equal(parseTraceReading({ ...good, note: '   ' }, now).note, null);
});

test('bad, impossible or stale readings are dropped', () => {
  for (const bad of [
    null,
    'reading',
    { ...good, latitude: Number.NaN },
    { ...good, longitude: '-0.17' },
    { ...good, latitude: 91 },
    { ...good, longitude: -181 },
    { ...good, accuracy: 0 },
    { ...good, accuracy: 5001 },
    { ...good, timestamp: now + 61_000 },
    { ...good, timestamp: now - 61 * 60 * 1000 },
  ]) {
    assert.equal(parseTraceReading(bad, now), null, JSON.stringify(bad));
  }
});

test('the live trail is admin-only, sent in small batches and kept for 24 hours', () => {
  const route = read('src', 'app', 'api', 'attendance', 'location', 'trace', 'route.ts');
  assert.match(route, /const authError = await enforceRole\(\['admin'\]\);/);
  assert.match(route, /const MAX_READINGS = 20;/);
  assert.match(route, /rawReadings\.length === 0 \|\| rawReadings\.length > MAX_READINGS/);
  assert.match(route, /const KEEP_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(route, /db\.delete\(locationTrace\)\.where\(lt\(locationTrace\.createdAt, new Date\(now - KEEP_MS\)\)\)/);
  assert.match(read('drizzle', '0035_location_trace.sql'), /CREATE TABLE IF NOT EXISTS location_trace/);
  assert.match(read('src', 'proxy.ts'), /'\/api\/attendance\(\.\*\)',/);
});

test('sharing sends batches, keeps unsent readings, keeps the screen on and stops by itself', () => {
  const share = read('src', 'components', 'location', 'live-location-share.tsx');
  assert.match(share, /const MAX_BATCH = 20;/);
  assert.match(share, /const batch = bufferRef\.current\.splice\(0, MAX_BATCH\);/);
  assert.match(share, /bufferRef\.current = \[\.\.\.batch, \.\.\.bufferRef\.current\]\.slice\(-MAX_BUFFER\);/);
  assert.match(share, /const AUTO_STOP_MS = 30 \* 60 \* 1000;/);
  assert.match(share, /autoStop: window\.setTimeout\(\(\) => stop\(\), AUTO_STOP_MS\)/);
  assert.match(share, /wakeLock\.request\('screen'\)/);
  // People sign in on any network they like, so nothing here talks about Wi-Fi or networks.
  assert.doesNotMatch(share, /wi-?fi|network/i);
  assert.match(read('src', 'app', 'location', 'measure', 'page.tsx'), /<LiveLocationShare \/>\n\s+<MeasureGroundsCard office=\{office\} \/>/);
});

test('admins reach Measure grounds from the check-in screen through a dot that moves nothing', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  const route = read('src', 'app', 'api', 'attendance', 'check-in', 'route.ts');
  assert.match(route, /isAdmin: isAdminUser\(user, session\.sessionClaims\),/);
  assert.match(read('src', 'lib', 'auth', 'roles.ts'), /export function isAdminUser\(user: ClerkUser, sessionClaims: unknown\) \{\n\s+return resolveRole\(user, sessionClaims\) === 'admin';/);
  assert.match(page, /<header className="flex h-12 shrink-0 items-center justify-between sm:h-14">/);
  assert.match(page, /\{status\?\.isAdmin && \(/);
  assert.match(page, /href="\/location\/measure"\n\s+className="flex h-7 w-7 shrink-0/);
});
