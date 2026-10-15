/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { averageLocationFixes, getDistanceMeters } = require('../src/lib/geo-location.ts');

test('a corner is the accuracy-weighted average of its readings, dropping far worse ones', () => {
  const corner = { latitude: 5.566, longitude: -0.1774 };
  const north = (meters) => meters / 111_320;
  const point = averageLocationFixes([
    { accuracy: 4, latitude: corner.latitude + north(2), longitude: corner.longitude },
    { accuracy: 4, latitude: corner.latitude - north(2), longitude: corner.longitude },
    { accuracy: 8, latitude: corner.latitude + north(4), longitude: corner.longitude },
    // A vague reading 60 m off is ignored (worse than twice the best and over 10 m).
    { accuracy: 45, latitude: corner.latitude + north(60), longitude: corner.longitude },
  ]);
  assert.equal(point.readings, 3);
  assert.ok(getDistanceMeters(point, corner) < 1, 'the average sits on the corner');
  assert.ok(point.accuracy >= 4, 'never claims better than the best reading');
});

test('readings that disagree widen the reported accuracy; no readings give no corner', () => {
  const point = averageLocationFixes([
    { accuracy: 3, latitude: 5.566, longitude: -0.1774 },
    { accuracy: 3, latitude: 5.566 + 20 / 111_320, longitude: -0.1774 },
  ]);
  assert.ok(point.accuracy > 9, `spread shows in the accuracy (${point.accuracy})`);
  assert.equal(averageLocationFixes([]), null);
  assert.equal(averageLocationFixes([{ accuracy: Number.NaN, latitude: 5, longitude: 0 }]), null);
});

test('measured corners are saved by admins only, to the audit trail, without touching the office', () => {
  const route = read('src', 'app', 'api', 'attendance', 'location', 'measurements', 'route.ts');
  assert.match(route, /const authError = await enforceRole\(\['admin'\]\);/);
  assert.match(route, /entityType: 'office_grounds_measurement'/);
  assert.doesNotMatch(route, /officeLocation/);
  assert.match(route, /rawPoints\.length > MAX_POINTS/);
});

test('Measure grounds works on a phone, with averaged corners kept through a reload', () => {
  const page = read('src', 'app', 'location', 'page.tsx');
  const measurePage = read('src', 'app', 'location', 'measure', 'page.tsx');
  const card = read('src', 'components', 'location', 'measure-grounds.tsx');
  // Its own page outside the desktop-only shell; still admin-only through the proxy (/location).
  assert.match(measurePage, /<MeasureGroundsCard office=\{office\} \/>/);
  assert.doesNotMatch(measurePage, /DashboardLayout/);
  assert.match(read('src', 'components', 'layout', 'app-shell.tsx'), /const PHONE_ADMIN_PAGES = new Set\(\['\/location\/measure'\]\);/);
  assert.match(read('src', 'proxy.ts'), /'\/location\(\.\*\)',/);
  assert.match(page, /\/location\/measure/);
  assert.match(card, /const point = averageLocationFixes\(fixesRef\.current\);/);
  assert.match(card, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(corners\)\)/);
  assert.match(card, /fetch\('\/api\/attendance\/location\/measurements'/);
  assert.match(card, /const MAX_RECORD_MS = 15_000;/);
});
