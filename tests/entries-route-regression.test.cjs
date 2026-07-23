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
  entrySubmission: [],
  latenessEntry: [],
  staff: [],
  workCalendar: [],
};

function resetFixture() {
  fixture.attendancePermission = [];
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInAt: new Date('2026-05-06T09:12:00.000Z'),
      checkInTime: '09:12:00',
      computedAmount: '10.00',
      date: '2026-05-06',
      reason: "DIDN'T COME BEFORE 8:30AM",
      noSignOutWaived: false,
      noSignOutWaivedAt: null,
      noSignOutWaivedByEmail: null,
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: null,
      signOutAt: null,
      signOutTime: null,
      staffId: 'staff-1',
      status: 'late',
      updatedAt: new Date('2026-05-06T09:12:00.000Z'),
    },
  ];
  fixture.entrySubmission = [];
  fixture.latenessEntry = [
    {
      id: 'entry-1',
      arrivalTime: '09:12:00',
      computedAmount: '10.00',
      createdAt: new Date('2026-05-06T09:12:00.000Z'),
      date: '2026-05-06',
      didNotSignOut: false,
      reason: "DIDN'T COME BEFORE 8:30AM",
      staffId: 'staff-1',
      updatedAt: new Date('2026-05-06T09:12:00.000Z'),
    },
  ];
  fixture.staff = [
    {
      id: 'staff-1',
      fullName: 'CARL CHRISTIAN QUIST',
      active: true,
      archived: false,
      isAttendanceOnly: false,
      isNssPersonnel: false,
    },
  ];
  fixture.workCalendar = [];
}

function cloneRow(row) {
  return {
    ...row,
    checkInAt: row.checkInAt instanceof Date ? new Date(row.checkInAt.getTime()) : row.checkInAt,
    createdAt: row.createdAt instanceof Date ? new Date(row.createdAt.getTime()) : row.createdAt,
    signOutAt: row.signOutAt instanceof Date ? new Date(row.signOutAt.getTime()) : row.signOutAt,
    submittedAt: row.submittedAt instanceof Date ? new Date(row.submittedAt.getTime()) : row.submittedAt,
    updatedAt: row.updatedAt instanceof Date ? new Date(row.updatedAt.getTime()) : row.updatedAt,
  };
}

function selectRows(tableName) {
  return fixture[tableName].map(cloneRow);
}

function resultWrapper(rows) {
  return {
    limit(count) {
      return Promise.resolve(rows.slice(0, count));
    },
    orderBy() {
      return Promise.resolve(rows);
    },
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
}

function updateTable(tableName, values) {
  if (tableName === 'attendanceRecord') {
    fixture.attendanceRecord = fixture.attendanceRecord.map((row) => row.id === 'attendance-1' ? { ...row, ...values } : row);
    return [cloneRow(fixture.attendanceRecord[0])];
  }

  if (tableName === 'latenessEntry') {
    fixture.latenessEntry = fixture.latenessEntry.map((row) => row.id === 'entry-1' ? { ...row, ...values } : row);
    return fixture.latenessEntry.map(cloneRow);
  }

  throw new Error(`Unexpected update table: ${tableName}`);
}

function insertIntoTable(tableName, values) {
  if (tableName === 'attendanceRecord') {
    const nextRow = { id: `attendance-${fixture.attendanceRecord.length + 1}`, ...values };
    fixture.attendanceRecord.push(nextRow);
    return [cloneRow(nextRow)];
  }

  if (tableName === 'entrySubmission') {
    const existing = fixture.entrySubmission.find((row) => row.date === values.date);
    const nextRow = existing
      ? { ...existing, ...values }
      : { id: `submission-${fixture.entrySubmission.length + 1}`, ...values };

    fixture.entrySubmission = existing
      ? fixture.entrySubmission.map((row) => row.date === values.date ? nextRow : row)
      : [...fixture.entrySubmission, nextRow];

    return [cloneRow(nextRow)];
  }

  if (tableName === 'latenessEntry') {
    const nextRow = { id: `entry-${fixture.latenessEntry.length + 1}`, ...values };
    fixture.latenessEntry.push(nextRow);
    return [cloneRow(nextRow)];
  }

  throw new Error(`Unexpected insert table: ${tableName}`);
}

const schema = {
  attendancePermission: createTable('attendancePermission', ['date', 'staffId', 'status']),
  attendanceRecord: createTable('attendanceRecord', [
    'id',
    'staffId',
    'date',
    'noSignOutWaived',
    'noSignOutWaivedAt',
    'noSignOutWaivedByEmail',
    'noSignOutWaivedByUserId',
    'noSignOutWaivedReason',
    'signOutAt',
    'signOutTime',
  ]),
  entrySubmission: createTable('entrySubmission', ['date']),
  latenessEntry: createTable('latenessEntry', ['id', 'date']),
  staff: createTable('staff', ['id', 'fullName', 'active', 'archived', 'isAttendanceOnly', 'isNssPersonnel']),
  workCalendar: createTable('workCalendar', ['date', 'isHoliday']),
};

const fakeDb = {
  delete(table) {
    return {
      where() {
        if (table.__table === 'latenessEntry') {
          fixture.latenessEntry = [];
          return Promise.resolve();
        }

        throw new Error(`Unexpected delete table: ${table.__table}`);
      },
    };
  },
  insert(table) {
    return {
      values(values) {
        return {
          onConflictDoUpdate({ set }) {
            return {
              returning() {
                return Promise.resolve(insertIntoTable(table.__table, { ...values, ...set }));
              },
            };
          },
          returning() {
            return Promise.resolve(insertIntoTable(table.__table, values));
          },
        };
      },
    };
  },
  select() {
    return {
      from(table) {
        const rows = selectRows(table.__table);
        return {
          limit(count) {
            return Promise.resolve(rows.slice(0, count));
          },
          where() {
            return resultWrapper(rows);
          },
          then(resolve, reject) {
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
      },
    };
  },
  update(table) {
    return {
      set(values) {
        return {
          where() {
            return {
              returning() {
                return Promise.resolve(updateTable(table.__table, values));
              },
            };
          },
        };
      },
    };
  },
};

Module._load = function patchedLoad(request, ...args) {
  if (request === '@/db') return { db: fakeDb };
  if (request === '@/db/schema') return schema;
  if (request === '@/lib/audit') {
    return {
      getAuditActor: async () => ({ actorEmail: 'admin@example.com', actorUserId: 'admin-1' }),
      writeAuditEvent: async () => null,
    };
  }
  if (request === '@/lib/auth/roles') {
    return {
      enforceRole: async () => null,
    };
  }
  if (request === '@/lib/realtime') {
    return {
      publishRealtime: () => null,
    };
  }
  if (request === '@/lib/attendance-lateness-sync') {
    return {
      syncLatenessEntriesFromAttendanceForDate: async () => ({ inserted: 0, updated: 0 }),
      syncLatenessEntriesFromAttendanceForRange: async () => ({ inserted: 0, updated: 0 }),
    };
  }
  if (request === 'drizzle-orm') {
    return {
      and: (...conditions) => conditions,
      eq: (left, right) => ({ left, op: 'eq', right }),
      gte: (left, right) => ({ left, op: 'gte', right }),
      lte: (left, right) => ({ left, op: 'lte', right }),
    };
  }

  return originalLoad.call(this, request, ...args);
};

require('tsx/cjs');

const { GET, POST } = require('../src/app/api/entries/route.ts');

test.after(() => {
  Module._load = originalLoad;
});

test('saving a corrected lateness entry also updates the linked attendance record', async () => {
  resetFixture();

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 1);
  assert.deepEqual(responseBody.changedStaffNames, ['CARL CHRISTIAN QUIST']);
  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].checkInTime, '08:05');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
});

test('saving a no-op submitted row does not report a changed staff member', async () => {
  resetFixture();
  fixture.attendanceRecord[0].computedAmount = '15.00';
  fixture.latenessEntry[0].computedAmount = '15';

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '09:12',
          didNotSignOut: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 0);
  assert.deepEqual(responseBody.changedStaffNames, []);
  assert.equal(responseBody.count, 0);
  assert.equal(responseBody.attendanceCount, 0);
  assert.equal(responseBody.deletedCount, 0);
});

test('saving attendance and lateness changes for one staff reports that staff once', async () => {
  resetFixture();

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '10:31',
          didNotSignOut: true,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 1);
  assert.deepEqual(responseBody.changedStaffNames, ['CARL CHRISTIAN QUIST']);
  assert.equal(responseBody.attendanceCount, 1);
  assert.equal(responseBody.count, 1);
});

test('clearing no-sign-out from entries stores a waiver instead of a fake sign-out', async () => {
  resetFixture();
  fixture.attendanceRecord[0] = {
    ...fixture.attendanceRecord[0],
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05:00',
    computedAmount: '2.00',
    reason: 'DID NOT SIGN OUT',
    signOutAt: null,
    signOutTime: null,
    status: 'late',
  };
  fixture.latenessEntry[0] = {
    ...fixture.latenessEntry[0],
    arrivalTime: '08:05:00',
    computedAmount: '2.00',
    didNotSignOut: true,
    reason: 'DID NOT SIGN OUT',
  };

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: false,
          didNotSignOutChanged: true,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 1);
  assert.equal(fixture.attendanceRecord[0].signOutTime, null);
  assert.equal(fixture.attendanceRecord[0].signOutAt, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, true);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedByEmail, 'admin@example.com');
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedReason, 'entries_no_sign_out_cleared');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
  assert.equal(fixture.latenessEntry.length, 0);
});

test('entries GET includes attendance sign-out time even when a lateness row wins', async () => {
  resetFixture();
  fixture.attendanceRecord[0].signOutAt = new Date('2026-05-06T16:45:00.000Z');
  fixture.attendanceRecord[0].signOutTime = '16:45:00';

  const response = await GET(new Request('http://localhost/api/entries?date=2026-05-06'));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.length, 1);
  assert.equal(responseBody[0].id, 'entry-1');
  assert.equal(responseBody[0].signOutTime, '16:45:00');
});

test('setting a real sign-out time from entries clears no-sign-out debt and waiver', async () => {
  resetFixture();
  fixture.attendanceRecord[0] = {
    ...fixture.attendanceRecord[0],
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05:00',
    computedAmount: '2.00',
    reason: 'DID NOT SIGN OUT',
    signOutAt: null,
    signOutTime: null,
    noSignOutWaived: true,
    noSignOutWaivedAt: new Date('2026-05-07T09:00:00.000Z'),
    noSignOutWaivedByEmail: 'admin@example.com',
    noSignOutWaivedByUserId: null,
    noSignOutWaivedReason: 'entries_no_sign_out_cleared',
    status: 'late',
  };
  fixture.latenessEntry[0] = {
    ...fixture.latenessEntry[0],
    arrivalTime: '08:05:00',
    computedAmount: '2.00',
    didNotSignOut: true,
    reason: 'DID NOT SIGN OUT',
  };

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: false,
          noSignOutWaived: false,
          noSignOutWaivedChanged: true,
          signOutTime: '16:50',
          signOutTimeChanged: true,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 1);
  assert.equal(fixture.attendanceRecord[0].signOutTime, '16:50');
  assert.deepEqual(fixture.attendanceRecord[0].signOutAt, new Date('2026-05-06T16:50:00.000Z'));
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, false);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedAt, null);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.latenessEntry.length, 0);
});

test('waiving a missing sign-out from entries clears debt without saving a sign-out time', async () => {
  resetFixture();
  fixture.attendanceRecord[0] = {
    ...fixture.attendanceRecord[0],
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05:00',
    computedAmount: '2.00',
    reason: 'DID NOT SIGN OUT',
    signOutAt: null,
    signOutTime: null,
    status: 'late',
  };
  fixture.latenessEntry[0] = {
    ...fixture.latenessEntry[0],
    arrivalTime: '08:05:00',
    computedAmount: '2.00',
    didNotSignOut: true,
    reason: 'DID NOT SIGN OUT',
  };

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: false,
          noSignOutWaived: true,
          noSignOutWaivedChanged: true,
          signOutTime: '',
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.attendanceRecord[0].signOutTime, null);
  assert.equal(fixture.attendanceRecord[0].signOutAt, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, true);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.latenessEntry.length, 0);
});

test('checking no-sign-out from entries clears sign-out and removes an existing waiver', async () => {
  resetFixture();
  fixture.attendanceRecord[0] = {
    ...fixture.attendanceRecord[0],
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05:00',
    computedAmount: '0.00',
    reason: null,
    signOutAt: new Date('2026-05-06T16:45:00.000Z'),
    signOutTime: '16:45:00',
    noSignOutWaived: true,
    noSignOutWaivedAt: new Date('2026-05-07T09:00:00.000Z'),
    noSignOutWaivedByEmail: 'admin@example.com',
    noSignOutWaivedByUserId: null,
    noSignOutWaivedReason: 'entries_no_sign_out_cleared',
    status: 'present',
  };
  fixture.latenessEntry = [];

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: true,
          didNotSignOutChanged: true,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.changedStaffCount, 1);
  assert.equal(fixture.attendanceRecord[0].signOutTime, null);
  assert.equal(fixture.attendanceRecord[0].signOutAt, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, false);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedAt, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedByEmail, null);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedReason, null);
  assert.equal(fixture.attendanceRecord[0].computedAmount, '2.00');
  assert.equal(fixture.attendanceRecord[0].reason, 'DID NOT SIGN OUT');
  assert.equal(fixture.attendanceRecord[0].status, 'late');
  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].didNotSignOut, true);
});

test('arrival edits preserve an existing no-sign-out waiver', async () => {
  resetFixture();
  fixture.attendanceRecord[0] = {
    ...fixture.attendanceRecord[0],
    checkInAt: new Date('2026-05-06T08:05:00.000Z'),
    checkInTime: '08:05:00',
    computedAmount: '0.00',
    reason: null,
    noSignOutWaived: true,
    noSignOutWaivedAt: new Date('2026-05-07T09:00:00.000Z'),
    noSignOutWaivedByEmail: 'admin@example.com',
    noSignOutWaivedByUserId: null,
    noSignOutWaivedReason: 'entries_no_sign_out_cleared',
    signOutAt: null,
    signOutTime: null,
    status: 'present',
  };
  fixture.latenessEntry = [];

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:10',
          didNotSignOut: false,
          didNotSignOutChanged: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.attendanceRecord[0].checkInTime, '08:10');
  assert.equal(fixture.attendanceRecord[0].noSignOutWaived, true);
  assert.equal(fixture.attendanceRecord[0].noSignOutWaivedReason, 'entries_no_sign_out_cleared');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.latenessEntry.length, 0);
});

test('saving entries creates a manual attendance check-in when staff has no attendance record', async () => {
  resetFixture();
  fixture.attendanceRecord = [];
  fixture.latenessEntry = [];

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '08:05',
          didNotSignOut: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.attendanceCount, 1);
  assert.equal(responseBody.changedStaffCount, 1);
  assert.deepEqual(responseBody.changedStaffNames, ['CARL CHRISTIAN QUIST']);
  assert.equal(fixture.attendanceRecord.length, 1);
  assert.equal(fixture.attendanceRecord[0].checkInTime, '08:05');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].source, 'entries_manual_check_in');
  assert.equal(fixture.attendanceRecord[0].status, 'present');
  assert.equal(fixture.latenessEntry.length, 0);
});

test('saving a lateness entry uses the NSS flat late penalty', async () => {
  resetFixture();
  fixture.staff[0].isNssPersonnel = true;

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '10:31',
          didNotSignOut: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.latenessEntry.length, 1);
  assert.equal(fixture.latenessEntry[0].computedAmount, '10');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '10.00');
});

test('saving lateness entries respects an approved general pardon', async () => {
  resetFixture();
  fixture.attendancePermission = [
    {
      id: 'permission-1',
      arrivalWindow: 'any_time_today',
      date: '2026-05-06',
      expectedEndTime: null,
      expectedStartTime: null,
      permissionType: 'late_arrival',
      reason: 'general pardon',
      staffId: 'staff-1',
      status: 'approved',
    },
  ];

  const response = await POST(new Request('http://localhost/api/entries', {
    body: JSON.stringify({
      date: '2026-05-06',
      entries: [
        {
          arrivalTime: '10:31',
          didNotSignOut: false,
          staffId: 'staff-1',
        },
      ],
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].checkInTime, '10:31');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, 'Approved late arrival (Any time today): general pardon');
  assert.equal(fixture.attendanceRecord[0].status, 'present');
});
