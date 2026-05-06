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
  attendanceRecord: [],
  entrySubmission: [],
  latenessEntry: [],
  staff: [],
  workCalendar: [],
};

function resetFixture() {
  fixture.attendanceRecord = [
    {
      id: 'attendance-1',
      checkInAt: new Date('2026-05-06T09:12:00.000Z'),
      checkInTime: '09:12:00',
      computedAmount: '10.00',
      date: '2026-05-06',
      reason: "DIDN'T COME BEFORE 8:30AM",
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
    },
  ];
  fixture.workCalendar = [];
}

function cloneRow(row) {
  return {
    ...row,
    checkInAt: row.checkInAt instanceof Date ? new Date(row.checkInAt.getTime()) : row.checkInAt,
    createdAt: row.createdAt instanceof Date ? new Date(row.createdAt.getTime()) : row.createdAt,
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
  attendanceRecord: createTable('attendanceRecord', ['id', 'staffId', 'date']),
  entrySubmission: createTable('entrySubmission', ['date']),
  latenessEntry: createTable('latenessEntry', ['id', 'date']),
  staff: createTable('staff', ['id', 'fullName', 'active', 'archived']),
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

const { POST } = require('../src/app/api/entries/route.ts');

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
  assert.equal(fixture.latenessEntry.length, 0);
  assert.equal(fixture.attendanceRecord[0].checkInTime, '08:05');
  assert.equal(fixture.attendanceRecord[0].computedAmount, '0.00');
  assert.equal(fixture.attendanceRecord[0].reason, null);
  assert.equal(fixture.attendanceRecord[0].status, 'present');
});
