/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { boundaryCircle, boundaryContour, metersBeyondBoundary, nearestEdgeIndex, outlineCrossesItself, parseOfficeBoundary } = require('../src/lib/office-boundary.ts');
const { validateAttendanceLocation } = require('../src/lib/geo-location.ts');

// Points given in metres east/north of an origin near the office.
const origin = { latitude: 5.5658, longitude: -0.1775 };
const metersPerDegree = (Math.PI / 180) * 6_371_000;
const at = (east, north) => ({
  latitude: origin.latitude + north / metersPerDegree,
  longitude: origin.longitude + east / (metersPerDegree * Math.cos((origin.latitude * Math.PI) / 180)),
});

// Grounds 60 m wide and 120 m deep; the road edge runs along the front (south) wall.
const grounds = {
  outline: [at(0, 0), at(60, 0), at(60, 120), at(0, 120)],
  road: { allowanceMeters: 12, from: at(-50, 0), to: at(110, 0) },
  roomMeters: 25,
};

test('the grounds, plus room for phone error, are in; past the road allowance is out', () => {
  const boundary = parseOfficeBoundary(grounds);
  const beyond = (east, north) => metersBeyondBoundary(boundary, at(east, north));
  assert.ok(beyond(30, 60) <= 0, 'middle of the grounds');
  assert.ok(beyond(-20, 60) <= 0, '20 m outside a side wall is phone error');
  assert.ok(Math.abs(beyond(-30, 60) - 5) < 0.1, '30 m outside a side wall is 5 m beyond');
  assert.ok(beyond(30, 130) <= 0 && Math.abs(beyond(30, 150) - 5) < 0.1, 'the back gets the same room');
  assert.ok(beyond(30, -10) <= 0, '10 m past the road edge (in the road) is in');
  assert.ok(Math.abs(beyond(30, -15) - 3) < 0.1, 'across the road (15 m past the edge) is out');
});

test('unusable shapes are rejected and the allowances are kept sensible', () => {
  assert.equal(parseOfficeBoundary(null), null);
  assert.equal(parseOfficeBoundary({ ...grounds, outline: grounds.outline.slice(0, 2) }), null);
  assert.equal(parseOfficeBoundary({ ...grounds, outline: [at(0, 0), at(10, 0), at(20, 0)] }), null, 'no area');
  assert.equal(parseOfficeBoundary({ ...grounds, outline: [...grounds.outline.slice(0, 3), { latitude: 'x', longitude: 0 }] }), null);
  // A road line drawn through the grounds would cut part of them off.
  assert.equal(parseOfficeBoundary({ ...grounds, road: { allowanceMeters: 12, from: at(-50, 60), to: at(110, 60) } }), null);
  assert.equal(parseOfficeBoundary({ ...grounds, roomMeters: 900 }).roomMeters, 100);
  assert.equal(parseOfficeBoundary({ ...grounds, roomMeters: -5 }).roomMeters, 0);
  assert.equal(parseOfficeBoundary({ ...grounds, road: null }).road, null);
});

test('sign-in follows the shape when it is set, and the circle when it is not', () => {
  const now = new Date('2026-10-15T08:00:00Z');
  const office = { latitude: grounds.outline[0].latitude, longitude: grounds.outline[0].longitude, maxAccuracyMeters: 100, radiusMeters: 10 };
  const reading = (point) => ({ accuracy: 8, ...point, timestamp: now.toISOString() });
  // 120 m from the pin but at the back of the grounds: in with the shape, out with the 10 m circle.
  const back = validateAttendanceLocation({ evidence: reading(at(30, 110)), now, office: { ...office, boundary: grounds } });
  assert.equal(back.ok, true);
  assert.equal(validateAttendanceLocation({ evidence: reading(at(30, 110)), now, office }).result, 'OUTSIDE_OFFICE_LOCATION');
  const across = validateAttendanceLocation({ evidence: reading(at(30, -20)), now, office: { ...office, boundary: grounds } });
  assert.equal(across.result, 'OUTSIDE_OFFICE_LOCATION');
  assert.equal(across.message, 'You appear to be 8m outside the office grounds.');
  // A broken saved shape falls back to the circle rather than letting everyone in.
  assert.equal(validateAttendanceLocation({ evidence: reading(at(30, 110)), now, office: { ...office, boundary: { outline: [] } } }).ok, false);
});

test('the boundary line drawn on the map follows the rule', () => {
  const boundary = parseOfficeBoundary(grounds);
  const segments = boundaryContour(boundary, 2);
  assert.ok(segments.length > 50);
  for (const [a, b] of segments) {
    assert.ok(Math.abs(metersBeyondBoundary(boundary, a)) < 2.5);
    assert.ok(Math.abs(metersBeyondBoundary(boundary, b)) < 2.5);
  }
});

test('a boundary is proposed, then approved by an admin, all in the audit trail', () => {
  const route = read('src', 'app', 'api', 'attendance', 'location', 'boundary', 'route.ts');
  assert.equal(route.match(/const authError = await enforceRole\(\['admin'\]\);/g).length, 2);
  assert.match(route, /const ACTIONS = \['save', 'propose', 'approve', 'discard', 'remove'\] as const;/);
  assert.match(route, /changes = \{ boundaryDraftJson: proposed \};/);
  assert.match(route, /if \(!draft\) return NextResponse\.json\(\{ error: 'There is no proposed boundary to approve' \}, \{ status: 409 \}\);/);
  assert.match(route, /reason: `office-boundary-\$\{action\}`/);
  assert.match(read('drizzle', '0036_office_boundary.sql'), /ADD COLUMN IF NOT EXISTS boundary_json jsonb;\nALTER TABLE office_location ADD COLUMN IF NOT EXISTS boundary_draft_json jsonb;/);

  // The phone's live check and the server's check use the same shape.
  const checkIn = read('src', 'app', 'api', 'attendance', 'check-in', 'route.ts');
  assert.match(checkIn, /boundary: officeLocation\.boundaryJson,/);
  assert.match(checkIn, /boundary: parseOfficeBoundary\(location\.boundaryJson\),/);
  assert.match(read('src', 'app', 'check-in', 'page.tsx'), /boundary: locationPolicy\.boundary,/);

  // Re-saving the pin on the grounds keeps the shape; a far-away pin starts with the circle.
  const location = read('src', 'app', 'api', 'attendance', 'location', 'route.ts');
  assert.match(location, /return boundary && metersBeyondBoundary\(boundary, \{ latitude, longitude \}\) <= 0 \? boundary : null;/);
  assert.match(location, /boundaryJson: keptBoundary\(before\?\.boundaryJson\),/);

  const page = read('src', 'app', 'location', 'page.tsx');
  assert.match(page, /fetch\('\/api\/attendance\/location\/boundary', \{ cache: 'no-store' \}\)/);
  assert.match(page, /'Use this area for every sign-in from now on\?'/);
  // Saving or approving an area also moves the pin to its middle, with a circle covering every edge.
  assert.match(route, /changes = \{ boundaryDraftJson: null, boundaryJson: saved, \.\.\.pin \};/);
  assert.match(route, /changes = \{ boundaryDraftJson: null, boundaryJson: draft, \.\.\.pin \};/);
});

test('the office pin and circle made from an area sit in its middle and cover every edge', () => {
  const boundary = parseOfficeBoundary(grounds);
  const circle = boundaryCircle(boundary);
  assert.ok(metersBeyondBoundary(boundary, circle) <= 0, 'the pin is inside the area');
  const metersBetween = (a, b) => Math.hypot(
    (a.longitude - b.longitude) * metersPerDegree * Math.cos((a.latitude * Math.PI) / 180),
    (a.latitude - b.latitude) * metersPerDegree,
  );
  let farthest = 0;
  for (const [a, b] of boundaryContour(boundary, 0.5)) {
    farthest = Math.max(farthest, metersBetween(circle, a), metersBetween(circle, b));
  }
  // Covers every edge, and no bigger than it needs to be (rounded up to the next metre, plus 1 m).
  assert.ok(farthest <= circle.radiusMeters, `${farthest} <= ${circle.radiusMeters}`);
  assert.ok(circle.radiusMeters - farthest <= 2.2, `tight: ${circle.radiusMeters} vs ${farthest}`);
  // Grounds 110 m x 157 m once the room and road allowance are added: about 96 m across the corner.
  assert.ok(circle.radiusMeters >= 90 && circle.radiusMeters <= 100, String(circle.radiusMeters));
});

test('a corner clicked on the map goes into the nearest edge', () => {
  const outline = grounds.outline; // (0,0) (60,0) (60,120) (0,120)
  assert.equal(nearestEdgeIndex(outline, at(30, -5)), 0, 'south edge: after corner 1');
  assert.equal(nearestEdgeIndex(outline, at(65, 60)), 1, 'east edge: after corner 2');
  assert.equal(nearestEdgeIndex(outline, at(-5, 60)), 3, 'west edge: after the last corner');
  assert.equal(nearestEdgeIndex(outline.slice(0, 2), at(0, 0)), 1, 'fewer than 3 corners: at the end');
});

test('an outline whose sides cross is not an area', () => {
  const [a, b, c, d] = grounds.outline;
  assert.equal(outlineCrossesItself(grounds.outline), false);
  assert.equal(outlineCrossesItself([a, c, b, d]), true, 'corners out of order make a bow-tie');
  assert.equal(parseOfficeBoundary({ ...grounds, outline: [a, c, b, d] }), null);
});

test('the first area saved where no office exists yet creates the office from it', () => {
  const route = read('src', 'app', 'api', 'attendance', 'location', 'boundary', 'route.ts');
  assert.match(route, /const firstArea = action === 'save' \? parseOfficeBoundary\(body\?\.boundary\) : null;/);
  assert.match(route, /if \(!firstArea\) return NextResponse\.json\(\{ error: 'Draw the office area first' \}, \{ status: 409 \}\);/);
  assert.match(route, /\.\.\.pinFromBoundary\(firstArea\),\n\s+\}\)\.returning\(\);/);
});
