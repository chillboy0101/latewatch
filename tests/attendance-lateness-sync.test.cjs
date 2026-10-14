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
  latenessDebtPardonEntry: [],
  latenessEntry: [],
  latenessPaymentAllocation: [],
  leavePeriods: [],
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
  fixture.latenessDebtPardonEntry = [];
  fixture.latenessPaymentAllocation = [];
  fixture.leavePeriods = [];
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
    .filter((row) => !(row.date || row.entryDate) || rowInRange({ date: row.date || row.entryDate }, start, end))
    .map(cloneRow);
}

const fakeDb = {
  delete(table) {
    return {
      where(condition) {
        if (table.__table !== 'latenessEntry') throw new Error(`Unexpected delete table: ${table.__table}`);
        const id = eqIdFromCondition(condition);
        if (fixture.latenessDebtPardonEntry.some((row) => row.entryId === id)) {
          throw Object.assign(new Error('Foreign key violation: pardon entry restricts deletion'), { code: '23503' });
        }
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
  latenessDebtPardonEntry: createTable('latenessDebtPardonEntry', ['entryDate', 'entryId']),
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
      getHolidayDatesForRange: async (startDate, endDate) => new Set(fixture.workCalendar
        .filter((row) => row.date >= startDate && row.date <= endDate && row.isHoliday && !row.isRemoved)
        .map((row) => row.date)),
      getAccraClock: () => ({
        dateKey: '2026-07-09',
        now: new Date('2026-07-09T12:00:00.000Z'),
        timeKey: '12:00:00',
      }),
    };
  }
  if (request === '@/lib/staff-leave-service') {
    return {
      getFinanciallyAllocatedEntryIds: async (entryIds) => new Set(entryIds.filter((id) => (
        fixture.latenessPaymentAllocation.some((row) => row.entryId === id)
      ))),
      getFinanciallyProtectedLeaveEntryIds: async (entryIds) => new Set(entryIds.filter((id) => (
        fixture.latenessPaymentAllocation.some((row) => row.entryId === id) ||
        fixture.latenessDebtPardonEntry.some((row) => row.entryId === id)
      ))),
      getPardonedEntryIds: async (entryIds) => new Set(entryIds.filter((id) => (
        fixture.latenessDebtPardonEntry.some((row) => row.entryId === id)
      ))),
      getStaffLeavePeriodsForRange: async ({ endDate, staffIds, startDate }) => fixture.leavePeriods.filter((period) => (
        period.startDate <= endDate && (!period.endDate || period.endDate >= startDate) &&
        (!staffIds || staffIds.includes(period.staffId))
      )),
    };
  }
  if (request === 'drizzle-orm') {
    return {
      and: (...conditions) => ({ conditions, op: 'and' }),
      eq: (left, right) => ({ left, op: 'eq', right }),
      gte: (left, right) => ({ left, op: 'gte', right }),
      inArray: (left, right) => ({ left, op: 'inArray', right }),
      isNotNull: (left) => ({ left, op: 'isNotNull' }),
      lte: (left, right) => ({ left, op: 'lte', right }),
      or: (...conditions) => ({ conditions, op: 'or' }),
    };
  }
  return originalLoad.call(this, request, ...args);
};

require('tsx/cjs');

const {
  applyNoShowSignInPenaltiesForDate,
  syncLatenessEntriesFromAttendanceForDate,
  syncLatenessEntriesFromAttendanceForRange,
} = require('../src/lib/attendance-lateness-sync.ts');

test.after(() => {
  Module._load = originalLoad;
});

test('sync clears stale attendance penalty when a general pardon clears late arrival', async () => {
  resetFixture();

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].status, 'excused');
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
  assert.equal(fixture.attendanceRecord[0].status, 'excused');
  assert.match(fixture.attendanceRecord[0].reason, /general pardon/);
});

test('sync leaves a pardoned entry and its attendance untouched, like a paid one', async () => {
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
  fixture.latenessDebtPardonEntry = [
    { entryDate: '2026-05-15', entryId: 'entry-1' },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '15.00');
  assert.equal(fixture.latenessEntry[0].reason, "DIDN'T COME BEFORE 8:30AM");
  assert.equal(fixture.attendanceRecord[0].computedAmount, '15.00');
});

test('sync leaves payment-allocated entries and linked attendance unchanged for review', async () => {
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
  fixture.latenessPaymentAllocation = [{ entryId: 'entry-1', allocatedAmount: '5.00' }];

  await syncLatenessEntriesFromAttendanceForDate('2026-05-15');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '15.00');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '15.00');
  assert.equal(fixture.latenessPaymentAllocation.length, 1);
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
  assert.equal(fixture.attendanceRecord[0].status, 'excused');
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
  assert.equal(fixture.attendanceRecord[0].status, 'present');
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
  assert.equal(fixture.latenessEntry[0].computedAmount, '10.00');
  assert.equal(fixture.latenessEntry[0].didNotSignOut, false);
  assert.equal(fixture.latenessEntry[0].reason, "DIDN'T SIGN IN BEFORE 4:30PM");
});

test('no-show date reconciliation clears an unprotected penalty during approved leave', async () => {
  resetFixture();
  fixture.attendanceRecord = [];
  fixture.attendancePermission = [];
  fixture.leavePeriods = [
    { endDate: '2026-07-08', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-07-08' },
  ];
  fixture.latenessEntry = [
    {
      id: 'entry-leave',
      arrivalTime: null,
      computedAmount: '10.00',
      date: '2026-07-08',
      didNotSignOut: false,
      reason: "DIDN'T SIGN IN BEFORE 4:30PM",
      staffId: 'staff-1',
    },
  ];

  const result = await applyNoShowSignInPenaltiesForDate('2026-07-08');

  assert.equal(result.deleted, 1);
  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord.length, 0);
});

test('no-show date reconciliation preserves paid or pardoned entries during leave', async () => {
  resetFixture();
  fixture.attendanceRecord = [];
  fixture.attendancePermission = [];
  fixture.leavePeriods = [
    { endDate: '2026-07-08', source: 'approved_leave', staffId: 'staff-1', startDate: '2026-07-08' },
  ];
  fixture.latenessEntry = [
    {
      id: 'entry-protected',
      arrivalTime: null,
      computedAmount: '10.00',
      date: '2026-07-08',
      didNotSignOut: false,
      reason: "DIDN'T SIGN IN BEFORE 4:30PM",
      staffId: 'staff-1',
    },
  ];
  fixture.latenessDebtPardonEntry = [
    { entryDate: '2026-07-08', entryId: 'entry-protected' },
  ];
  fixture.latenessPaymentAllocation = [
    { allocatedAmount: '10.00', entryId: 'entry-protected' },
  ];

  const result = await applyNoShowSignInPenaltiesForDate('2026-07-08');

  assert.equal(result.deleted, 0);
  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '10.00');
  assert.equal(fixture.latenessDebtPardonEntry.length, 1);
  assert.equal(fixture.latenessPaymentAllocation.length, 1);
});

test('sync does not create a no-show sign-in penalty for dates before the rule took effect', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [];
  fixture.latenessEntry = [];

  await syncLatenessEntriesFromAttendanceForDate('2026-07-07');

  assert.equal(fixture.latenessEntry.length, 0);
});

test('no-show charges start on the day the staff record was created', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [];
  fixture.staff[0].createdAt = new Date('2026-07-09T09:00:00.000Z');

  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');
  assert.equal(fixture.latenessEntry.length, 0);

  fixture.staff[0].createdAt = new Date('2026-07-08T15:00:00.000Z');
  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');
  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '10.00');
});

test('an un-waived no-show stays charged and its day stays absent', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [{
    checkInTime: null,
    computedAmount: '10.00',
    date: '2026-07-08',
    id: 'attendance-unwaived',
    noShowSignInWaived: false,
    noSignOutWaived: false,
    reason: null,
    signOutTime: null,
    source: 'no_show_sign_in_waiver',
    staffId: 'staff-1',
    status: 'absent',
  }];
  fixture.latenessEntry = [{
    arrivalTime: null,
    computedAmount: '10.00',
    date: '2026-07-08',
    didNotSignOut: false,
    id: 'entry-unwaived',
    reason: "DIDN'T SIGN IN BEFORE 4:30PM",
    staffId: 'staff-1',
  }];

  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');

  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '10.00');
  assert.equal(fixture.attendanceRecord[0].status, 'absent');
});

test('a holiday declared after the day started clears its late and no-show charges', async () => {
  resetFixture();
  fixture.attendancePermission = [];
  fixture.workCalendar = [{ date: '2026-07-08', isHoliday: true, isRemoved: false }];
  fixture.attendanceRecord = [{ ...fixture.attendanceRecord[0], date: '2026-07-08' }];
  fixture.latenessEntry = [
    {
      arrivalTime: '09:12:00',
      computedAmount: '15.00',
      date: '2026-07-08',
      didNotSignOut: false,
      id: 'entry-late',
      reason: "DIDN'T COME BEFORE 8:30AM",
      staffId: 'staff-1',
    },
    {
      arrivalTime: null,
      computedAmount: '10.00',
      date: '2026-07-08',
      didNotSignOut: false,
      id: 'entry-no-show',
      reason: "DIDN'T SIGN IN BEFORE 4:30PM",
      staffId: 'staff-2',
    },
  ];

  await syncLatenessEntriesFromAttendanceForDate('2026-07-08');

  assert.deepEqual(fixture.latenessEntry, []);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
});

test('a pardoned charge on an approved leave day is set to no charge; a paid one is left alone', async () => {
  resetFixture();
  fixture.attendanceRecord = [];
  fixture.attendancePermission = [];
  fixture.leavePeriods = [{ endDate: '2026-07-08', source: 'attendance_permission', staffId: 'staff-1', startDate: '2026-07-07' }];
  const noShow = (id, date) => ({ arrivalTime: null, computedAmount: '10.00', date, didNotSignOut: false, id, reason: "DIDN'T SIGN IN BEFORE 4:30PM", staffId: 'staff-1' });
  fixture.latenessEntry = [noShow('entry-pardoned', '2026-07-07'), noShow('entry-paid', '2026-07-08')];
  fixture.latenessDebtPardonEntry = [{ entryDate: '2026-07-07', entryId: 'entry-pardoned' }];
  fixture.latenessPaymentAllocation = [{ allocatedAmount: '10.00', entryId: 'entry-paid' }];

  await syncLatenessEntriesFromAttendanceForRange('2026-07-07', '2026-07-08');

  const byId = new Map(fixture.latenessEntry.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('entry-pardoned').computedAmount, '0.00');
  assert.equal(byId.get('entry-pardoned').reason, 'On approved leave');
  assert.equal(byId.get('entry-paid').computedAmount, '10.00');
});
