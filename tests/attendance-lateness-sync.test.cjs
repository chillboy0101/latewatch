/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

function createColumn(table, name) {
  return { name, table };
}

function createTable(name, columns) {
  const table = { __table: name };
  for (const column of columns) {
    table[column] = createColumn(name, column);
  }
  return table;
}

const fixture = {
  attendancePermission: [],
  attendanceRecord: [],
  latenessEntry: [],
  staff: [],
  workCalendar: [],
};

function resetFixture() {
  fixture.attendancePermission = [
    {
      id: 'permission-1',
      arrivalWindow: 'any_time_today',
      date: '2026-05-15',
      expectedEndTime: null,
      expectedStartTime: null,
      permissionType: 'late_arrival',
      reason: 'general pardon',
      staffId: 'staff-1',
      status: 'approved',
    },
  ];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '09:12:00',
      computedAmount: '15.00',
      date: '2026-05-15',
      reason: "DIDN'T COME BEFORE 8:30AM",
      noSignOutWaived: false,
      noSignOutWaivedAt: null,
      noSignOutWaivedByEmail: null,
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: null,
      signOutTime: '16:45:00',
      staffId: 'staff-1',
      status: 'late',
    },
  ];
  fixture.latenessEntry = [];
  fixture.workCalendar = [];
  fixture.staff = [
    {
      fullName: 'PARDONED STAFF',
      id: 'staff-1',
      isAttendanceOnly: false,
      isNssPersonnel: false,
    },
  ];
}

function cloneRow(row) {
  return { ...row };
}

function normalizeDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value;
}

function rowInRange(row, start, end) {
  const date = normalizeDate(row.date);
  return date >= start && date <= end;
}

function collectDateBounds(condition, bounds = { end: '9999-12-31', start: '0000-01-01' }) {
  if (!condition || typeof condition !== 'object') return bounds;
  if (Array.isArray(condition.conditions)) {
    for (const child of condition.conditions) collectDateBounds(child, bounds);
  }
  if (condition.op === 'gte' && condition.left?.name === 'date') bounds.start = condition.right;
  if (condition.op === 'lte' && condition.left?.name === 'date') bounds.end = condition.right;
  if (condition.op === 'eq' && condition.left?.name === 'date') {
    bounds.start = condition.right;
    bounds.end = condition.right;
  }
  return bounds;
}

function eqIdFromCondition(condition) {
  if (!condition || typeof condition !== 'object') return null;
  if (condition.op === 'eq' && condition.left?.name === 'id') return condition.right;
  if (Array.isArray(condition.conditions)) {
    for (const child of condition.conditions) {
      const value = eqIdFromCondition(child);
      if (value) return value;
    }
  }
  return null;
}

function attendanceRowsForCondition(condition) {
  const { end, start } = collectDateBounds(condition);
  return fixture.attendanceRecord
    .filter((row) => rowInRange(row, start, end))
    .map((row) => {
      const member = fixture.staff.find((staff) => staff.id === row.staffId) || {};
      return {
        ...cloneRow(row),
        isAttendanceOnly: member.isAttendanceOnly,
        isNssPersonnel: member.isNssPersonnel,
        staffName: member.fullName,
      };
    });
}

function rowsForTable(tableName, condition) {
  const { end, start } = collectDateBounds(condition);
  return fixture[tableName]
    .filter((row) => !row.date || rowInRange(row, start, end))
    .map(cloneRow);
}

const fakeDb = {
  delete(table) {
    return {
      where(condition) {
        if (table.__table !== 'latenessEntry') throw new Error(`Unexpected delete table: ${table.__table}`);
        const id = eqIdFromCondition(condition);
        fixture.latenessEntry = id
          ? fixture.latenessEntry.filter((row) => row.id !== id)
          : [];
        return Promise.resolve();
      },
    };
  },
  insert(table) {
    return {
      values(values) {
        return {
          onConflictDoNothing() {
            if (table.__table !== 'latenessEntry') throw new Error(`Unexpected insert table: ${table.__table}`);
            const existing = fixture.latenessEntry.find((row) => row.staffId === values.staffId && row.date === values.date);
            if (!existing) {
              fixture.latenessEntry.push({ id: `entry-${fixture.latenessEntry.length + 1}`, ...values });
            }
            return Promise.resolve();
          },
        };
      },
    };
  },
  select() {
    return {
      from(table) {
        return {
          leftJoin() {
            return {
              where(condition) {
                if (table.__table !== 'attendanceRecord') throw new Error(`Unexpected joined select table: ${table.__table}`);
                return Promise.resolve(attendanceRowsForCondition(condition));
              },
            };
          },
          where(condition) {
            return Promise.resolve(rowsForTable(table.__table, condition));
          },
        };
      },
    };
  },
  update(table) {
    return {
      set(values) {
        return {
          where(condition) {
            const id = eqIdFromCondition(condition);
            if (table.__table === 'attendanceRecord') {
              fixture.attendanceRecord = fixture.attendanceRecord.map((row) => row.id === id ? { ...row, ...values } : row);
              return Promise.resolve();
            }
            if (table.__table === 'latenessEntry') {
              fixture.latenessEntry = fixture.latenessEntry.map((row) => row.id === id ? { ...row, ...values } : row);
              return Promise.resolve();
            }
            throw new Error(`Unexpected update table: ${table.__table}`);
          },
        };
      },
    };
  },
};

const schema = {
  attendancePermission: createTable('attendancePermission', ['date', 'staffId', 'status']),
  attendanceRecord: createTable('attendanceRecord', [
    'checkInTime',
    'computedAmount',
    'date',
    'id',
    'noSignOutWaived',
    'noSignOutWaivedAt',
    'noSignOutWaivedByEmail',
    'noSignOutWaivedByUserId',
    'noSignOutWaivedReason',
    'reason',
    'signOutNetworkIp',
    'signOutTime',
    'staffId',
    'status',
    'updatedAt',
  ]),
  latenessEntry: createTable('latenessEntry', ['id', 'date', 'staffId']),
  staff: createTable('staff', ['id', 'fullName', 'isAttendanceOnly', 'isNssPersonnel']),
  workCalendar: createTable('workCalendar', ['date', 'isHoliday', 'isRemoved']),
};

Module._load = function patchedLoad(request, ...args) {
  if (request === 'server-only') return {};
  if (request === '@/db') return { db: fakeDb };
  if (request === '@/db/schema') return schema;
  if (request === '@/lib/attendance') {
    return {
      getAccraClock: () => ({
        dateKey: '2026-07-09',
        now: new Date('2026-07-09T12:00:00.000Z'),
        timeKey: '12:00:00',
      }),
    };
  }
  if (request === 'drizzle-orm') {
    return {
      and: (...conditions) => ({ conditions, op: 'and' }),
      eq: (left, right) => ({ left, op: 'eq', right }),
      gte: (left, right) => ({ left, op: 'gte', right }),
      lte: (left, right) => ({ left, op: 'lte', right }),
    };
  }
  return originalLoad.call(this, request, ...args);
};

require('tsx/cjs');

const { syncLatenessEntriesFromAttendanceForDate } = require('../src/lib/attendance-lateness-sync.ts');

test.after(() => {
  Module._load = originalLoad;
});

test('sync clears stale attendance penalty when a general pardon clears late arrival', async () => {
  resetFixture();

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].status, 'present');
  assert.match(fixture.attendanceRecord[0].reason, /general pardon/);
});

test('sync deletes an existing positive lateness entry when a general pardon clears late arrival', async () => {
  resetFixture();
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '09:12:00',
      computedAmount: '15.00',
      date: '2026-05-15',
      didNotSignOut: false,
      reason: "DIDN'T COME BEFORE 8:30AM",
      staffId: 'staff-1',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].status, 'present');
  assert.match(fixture.attendanceRecord[0].reason, /general pardon/);
});

test('sync keeps only the no-sign-out amount for a late-only general pardon', async () => {
  resetFixture();
  fixture.attendanceRecord[0].signOutTime = null;
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '09:12:00',
      computedAmount: '17.00',
      date: '2026-05-15',
      didNotSignOut: true,
      reason: "DIDN'T COME BEFORE 8:30AM AND DID NOT SIGN OUT",
      staffId: 'staff-1',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '2.00');
  assert.match(fixture.latenessEntry[0].reason, /DID NOT SIGN OUT/);
  assert.match(fixture.latenessEntry[0].reason, /general pardon/);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '2.00');
  assert.equal(fixture.attendanceRecord[0].status, 'late');
  assert.match(fixture.attendanceRecord[0].reason, /DID NOT SIGN OUT/);
  assert.match(fixture.attendanceRecord[0].reason, /general pardon/);
});

test('sync creates no-sign-out penalties for past attendance without sign-out', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      date: '2026-05-14',
      reason: null,
      signOutTime: null,
      staffId: 'staff-1',
      status: 'present',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-14');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].arrivalTime, '08:05');
  assert.equal(fixture.latenessEntry[0].computedAmount, '2.00');
  assert.equal(fixture.latenessEntry[0].didNotSignOut, true);
  assert.equal(fixture.latenessEntry[0].reason, 'DID NOT SIGN OUT');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '2.00');
  assert.equal(fixture.attendanceRecord[0].reason, 'DID NOT SIGN OUT');
  assert.equal(fixture.attendanceRecord[0].status, 'late');
});

test('sync clears stale no-sign-out penalties after a sign-out is recorded', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      reason: 'DID NOT SIGN OUT',
      signOutTime: '16:40:00',
      staffId: 'staff-1',
      status: 'late',
    },
  ];
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      didNotSignOut: true,
      reason: 'DID NOT SIGN OUT',
      staffId: 'staff-1',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-14');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
});

test('sync respects waived missing sign-outs and deletes regenerated penalties', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      date: '2026-05-14',
      reason: null,
      noSignOutWaived: true,
      noSignOutWaivedAt: new Date('2026-05-15T09:00:00.000Z'),
      noSignOutWaivedByEmail: 'admin@example.com',
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: 'entries_no_sign_out_cleared',
      signOutTime: null,
      staffId: 'staff-1',
      status: 'present',
    },
  ];
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      didNotSignOut: true,
      reason: 'DID NOT SIGN OUT',
      staffId: 'staff-1',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-14');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, true);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
});

test('sync deletes duplicate no-sign-out lateness rows for waived attendance', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      reason: 'DID NOT SIGN OUT',
      noSignOutWaived: true,
      noSignOutWaivedAt: new Date('2026-05-15T09:00:00.000Z'),
      noSignOutWaivedByEmail: 'admin@example.com',
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: 'entries_no_sign_out_cleared',
      signOutTime: null,
      staffId: 'staff-1',
      status: 'late',
    },
  ];
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      didNotSignOut: true,
      reason: 'DID NOT SIGN OUT',
      staffId: 'staff-1',
    },
    {
      id: 'entry-duplicate',
      arrivalTime: '08:05:00',
      computedAmount: '2.00',
      date: '2026-05-14',
      didNotSignOut: true,
      reason: 'DID NOT SIGN OUT',
      staffId: 'staff-1',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-14');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
});

test('sync converts legacy entries fallback sign-outs into waivers instead of debt', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInTime: '08:05:00',
      computedAmount: '0.00',
      date: '2026-05-14',
      reason: null,
      noSignOutWaived: false,
      noSignOutWaivedAt: null,
      noSignOutWaivedByEmail: null,
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: null,
      signOutNetworkIp: 'manual_admin',
      signOutTime: '17:00:00',
      staffId: 'staff-1',
      status: 'present',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-14');

  assert.equal(fixture.attendanceRecord[0].signOutTime, null);
  assert.equal(fixture.attendanceRecord[0].signOutNetworkIp, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, true);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedReason, 'legacy_entries_fallback_sign_out');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
  assert.equal(fixture.latenessEntry.length, 0);
});

test('sync creates one no-show sign-in penalty for staff with no attendance row', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [];
  fixture.latenessEntry = [];

  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');
  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].arrivalTime, null);
  assert.equal(fixture.latenessEntry[0].computedAmount, '50.00');
  assert.equal(fixture.latenessEntry[0].didNotSignOut, false);
  assert.equal(fixture.latenessEntry[0].reason, "DIDN'T SIGN IN BEFORE 4:30PM");
});

test('sync does not create a no-show sign-in penalty for dates before the rule took effect', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [];
  fixture.latenessEntry = [];

  await syncLatenessEntriesFromAttendanceForDate('2026-07-07');

  assert.equal(fixture.latenessEntry.length, 0);
});
