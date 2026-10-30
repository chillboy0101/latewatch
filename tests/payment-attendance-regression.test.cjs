/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

require('tsx/cjs');

const schema = require('../src/db/schema.ts');
const { staffOnDateFrom } = require('../src/lib/staff-type.ts');
const fixture = {};
const auditEvents = [];
const realtimeEvents = [];
let deletedRows;
let deleteProjection;

// Resolve real schema columns against fixture rows while evaluating the routes' filters.
function value(row, column) {
  const key = Object.keys(schema.staff).find((key) => schema.staff[key] === column);
  return row[key];
}
const orm = {
  ...require('drizzle-orm'),
  and: (...conditions) => (row) => conditions.filter(Boolean).every((condition) => condition(row)),
  or: (...conditions) => (row) => conditions.filter(Boolean).some((condition) => condition(row)),
  eq: (column, expected) => (row) => value(row, column) === expected,
  inArray: (column, expected) => (row) => expected.includes(value(row, column)),
};
const db = {
  select() {
    let table;
    let predicate;
    const query = {
      from(source) { table = source; return query; },
      where(condition) { predicate = condition; return query; },
      leftJoin() { return query; },
      innerJoin() { return query; },
      orderBy() { return query; },
      limit() { return query; },
      then(resolve, reject) {
        const rows = fixture[Object.keys(schema).find((key) => schema[key] === table)] || [];
        // Staff eligibility is the filter under test; other tables contain preselected rows.
        return Promise.resolve(table === schema.staff && predicate ? rows.filter(predicate) : rows)
          .then(resolve, reject);
      },
    };
    return query;
  },
  delete(table) {
    assert.equal(table, schema.latenessPayment);
    return {
      where() {
        return { returning: async (projection) => { deleteProjection = projection; return deletedRows; } };
      },
    };
  },
};

const mocks = {
  '@/db': { db },
  '@/db/schema': schema,
  'drizzle-orm': orm,
  '@clerk/nextjs/server': { auth: async () => ({ userId: 'admin' }), currentUser: async () => null },
  '@/lib/auth/roles': { enforceRole: async () => null },
  '@/lib/audit': { writeAuditEvent: async (event) => auditEvents.push(event) },
  '@/lib/realtime': { publishRealtime: (...event) => realtimeEvents.push(event) },
  '@/lib/attendance': {
    getAccraClock: () => ({ dateKey: '2026-10-17', timeKey: '12:00:00' }),
    getActiveOfficeNetwork: async () => null,
    getOfficeLocationsForAttendance: async () => [],
    resolveClientIpInfo: async () => ({ ip: 'unknown', isPublic: false, source: 'local' }),
  },
  '@/lib/attendance-lateness-sync': { syncLatenessEntriesFromAttendanceForDate: async () => undefined },
  '@/lib/staff-leave-service': { getStaffLeavePeriodsForRange: async () => [] },
  // Type history from the fixture (staffId -> changes); none unless a test sets it.
  '@/lib/staff-type-history': {
    staffOnDate: async (rows, date) => staffOnDateFrom(rows, date, new Map(
      rows.filter(({ id }) => fixture.typeChanges?.[id]).map(({ id }) => [id, fixture.typeChanges[id]]),
    )),
  },
  '@/lib/lateness-payment-record': {},
  '@/lib/lateness-payment-receipt-push': {},
};
const originalLoad = Module._load;
let attendanceGET;
let paymentsGET;
let undoDELETE;
Module._load = function patchedLoad(request, ...args) {
  if (Object.hasOwn(mocks, request)) return mocks[request];
  return originalLoad.call(this, request, ...args);
};
try {
  ({ GET: attendanceGET } = require('../src/app/api/attendance/route.ts'));
  ({ GET: paymentsGET } = require('../src/app/api/payments/lateness/route.ts'));
  ({ DELETE: undoDELETE } = require('../src/app/api/payments/lateness/[paymentId]/route.ts'));
} finally {
  Module._load = originalLoad;
}

test.beforeEach(() => {
  for (const key of Object.keys(fixture)) delete fixture[key];
  auditEvents.length = 0;
  realtimeEvents.length = 0;
  deletedRows = [];
  deleteProjection = undefined;
});

const member = (id, overrides = {}) => ({
  id, fullName: id, active: true, archived: false, isAttendanceOnly: false, ...overrides,
});

test('attendance totals all charge rows per staff member and keeps decimal strings and missing charges', async () => {
  fixture.staff = [member('a'), member('b'), member('c'), member('d')];
  fixture.latenessEntry = [
    { staffId: 'a', amount: '10.25' },
    { staffId: 'b', amount: '0.10' },
    { staffId: 'a', amount: '2.50' },
    { staffId: 'b', amount: '0.20' },
    { staffId: 'd', amount: '0.00' },
  ];
  const response = await attendanceGET(new Request('http://localhost/api/attendance?date=2026-10-17'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.rows.map(({ staff, penaltyAmount }) => [staff.id, penaltyAmount]), [
    ['a', '12.75'], ['b', '0.30'], ['c', null], ['d', '0.00'],
  ]);
});

test('attendance for a date lists who was on staff that day, by their type history', async () => {
  fixture.staff = [
    member('here'),
    member('left-since', { active: false }), // deactivated after the date: still listed that day
    member('away-then'), // back now, but away on the date
    member('archived', { active: false, archived: true }),
    member('archived-since', { active: false, archived: true }), // archived after the date: listed that day
    member('inactive-no-history', { active: false }),
    member('inactive-no-away-row', { active: false }), // the spell away was never written: today's status
    member('archived-but-active', { archived: true }), // archived counts as away now, whatever active says
    member('back-unrecorded'), // restored, but the return was never written: here from the last change on
  ];
  fixture.typeChanges = {
    'archived-since': [{ effectiveFrom: '2000-01-01', staffType: 'main' }, { effectiveFrom: '2026-10-25', staffType: 'away' }],
    'inactive-no-away-row': [{ effectiveFrom: '2000-01-01', staffType: 'intern' }, { effectiveFrom: '2026-06-01', staffType: 'main' }],
    'back-unrecorded': [{ effectiveFrom: '2000-01-01', staffType: 'main' }, { effectiveFrom: '2026-09-01', staffType: 'away' }],
    'left-since': [{ effectiveFrom: '2000-01-01', staffType: 'main' }, { effectiveFrom: '2026-10-20', staffType: 'away' }],
    'away-then': [{ effectiveFrom: '2026-09-01', staffType: 'away' }, { effectiveFrom: '2026-10-25', staffType: 'main' }],
  };
  const response = await attendanceGET(new Request('http://localhost/api/attendance?date=2026-10-17'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.rows.map(({ staff }) => staff.id), ['here', 'left-since', 'archived-since', 'back-unrecorded']);
  assert.equal(body.totals.totalStaff, 4);
});

test('attendance for a past date shows each person as the type they were that day', async () => {
  // Main staff now, but an intern until 20 October: on the 17th they were an intern.
  fixture.staff = [member('was-intern')];
  fixture.typeChanges = {
    'was-intern': [{ effectiveFrom: '2000-01-01', staffType: 'intern' }, { effectiveFrom: '2026-10-20', staffType: 'main' }],
  };
  const body = await (await attendanceGET(new Request('http://localhost/api/attendance?date=2026-10-17'))).json();
  assert.equal(body.rows[0].staff.isAttendanceOnly, true);
  assert.equal(body.rows[0].staff.isNssPersonnel, false);
  const today = await (await attendanceGET(new Request('http://localhost/api/attendance?date=2026-10-21'))).json();
  assert.equal(today.rows[0].staff.isAttendanceOnly, false);
});

test('filtered payments use the same roster eligibility as the full list, including historical staff', async () => {
  fixture.staff = [
    member('active'), member('inactive', { active: false }), member('archived', { archived: true }),
    member('attendance-only', { isAttendanceOnly: true }),
    member('charged-former', { active: false, archived: true, isAttendanceOnly: true }),
  ];
  fixture.latenessEntry = [{ staffId: 'charged-former', computedAmount: '0.00' }];
  const allResponse = await paymentsGET(new Request('http://localhost/api/payments/lateness'));
  assert.equal(allResponse.status, 200);
  const all = await allResponse.json();
  assert.deepEqual(all.staff.map(({ id }) => id), ['active', 'charged-former']);
  for (const { id } of fixture.staff) {
    const response = await paymentsGET(new Request(`http://localhost/api/payments/lateness?staffId=${id}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.staff.map((row) => row.id), all.staff.filter((row) => row.id === id).map((row) => row.id));
  }
});

function undoRequest() {
  return undoDELETE(new Request('http://localhost/api/payments/lateness/payment-1', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Duplicate payment' }),
  }), { params: Promise.resolve({ paymentId: 'payment-1' }) });
}

const payment = { id: 'payment-1', staffId: 'a', amount: '12.75' };

test('undo returns 404 without auditing or publishing when a concurrent request already deleted the payment', async () => {
  fixture.latenessPayment = [payment];
  const response = await undoRequest();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'This payment was not found (it may already have been undone)' });
  assert.deepEqual(deleteProjection, { id: schema.latenessPayment.id });
  assert.equal(auditEvents.length, 0);
  assert.equal(realtimeEvents.length, 0);
});

test('undo audits and publishes a confirmed deletion', async () => {
  fixture.latenessPayment = [payment];
  fixture.staff = [member('a')];
  deletedRows = [{ id: payment.id }];
  const response = await undoRequest();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, undoneAmount: '12.75' });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].entityId, payment.id);
  assert.deepEqual(auditEvents[0].after, { reason: 'Duplicate payment', undone: true });
  assert.ok(realtimeEvents.length > 0);
});

test('undo still returns 404 when the initial lookup finds no payment', async () => {
  const response = await undoRequest();
  assert.equal(response.status, 404);
  assert.equal(deleteProjection, undefined);
  assert.equal(auditEvents.length, 0);
  assert.equal(realtimeEvents.length, 0);
});
