/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const state = { batches: [], alerts: [], holidays: new Set(), runs: [] };

function rowsFor() {
  return state.runs.filter((run) => run.date === state.queryDate);
}

const fakeDb = {
  select() {
    return {
      from() {
        return {
          where() {
            const rows = rowsFor();
            return {
              limit: async (count) => rows.slice(0, count),
              then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
            };
          },
        };
      },
    };
  },
};

function loadFallback() {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (request === '@/db') return { db: fakeDb };
    if (request === '@/db/schema') return { reminderCronRun: { date: 'date', reminderType: 'reminderType', source: 'source', id: 'id' } };
    if (request === 'drizzle-orm') return { and: () => null, eq: () => null, inArray: () => null };
    if (request === '@/lib/attendance') {
      return {
        getAccraClock: (now) => {
          const iso = now.toISOString();
          state.queryDate = iso.slice(0, 10);
          return { dateKey: iso.slice(0, 10), now, timeKey: iso.slice(11, 19) };
        },
        getHolidayForDate: async (dateKey) => (state.holidays.has(dateKey) ? { holidayNote: 'Holiday' } : null),
        isWeekendDate: (dateKey) => [0, 6].includes(new Date(`${dateKey}T12:00:00Z`).getUTCDay()),
      };
    }
    if (request === '@/lib/push-reminders') {
      return {
        pushAdminAlert: async (input) => { state.alerts.push(input); },
        sendAttendanceReminderBatch: async (type, source) => {
          state.batches.push({ source, type });
          return { sent: 3 };
        },
      };
    }
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, 'src/lib/reminder-fallback.ts'));
  } finally {
    Module._load = originalLoad;
  }
}

const fallback = loadFallback();

function reset() {
  state.batches = [];
  state.alerts = [];
  state.runs = [];
  state.holidays = new Set();
}

test('fallback windows start 5 minutes after each cron; sign-in stops when sign-in closes at 4:30', () => {
  const { dueFallbackReminderType } = fallback;
  assert.equal(dueFallbackReminderType('08:19:00'), null);
  assert.equal(dueFallbackReminderType('08:20:00'), 'sign_in');
  assert.equal(dueFallbackReminderType('16:29:00'), 'sign_in');
  assert.equal(dueFallbackReminderType('16:30:00'), null);
  assert.equal(dueFallbackReminderType('16:34:00'), null);
  assert.equal(dueFallbackReminderType('16:35:00'), 'sign_out');
  assert.equal(dueFallbackReminderType('23:59:00'), 'sign_out');
  assert.equal(dueFallbackReminderType('07:00:00'), null);
});

test('a missed sign-out run is sent from the app once, and admins are told', async () => {
  reset();
  // Tue 13 Oct 2026, 16:40 Accra, no run recorded yet.
  const summary = await fallback.maybeRunMissedReminderBatch(new Date('2026-10-13T16:40:00Z'));
  assert.deepEqual(summary, { sent: 3 });
  assert.deepEqual(state.batches, [{ source: 'app', type: 'sign_out' }]);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].alertType, 'missed_sign_out');

  // Within the 5-minute throttle nothing else happens.
  await fallback.maybeRunMissedReminderBatch(new Date('2026-10-13T16:42:00Z'));
  assert.equal(state.batches.length, 1);
});

test('the fallback does nothing when a cron already ran, or on weekends and holidays', async () => {
  reset();
  state.runs = [{ date: '2026-10-14', reminderType: 'sign_out', source: 'vercel' }];
  assert.equal(await fallback.maybeRunMissedReminderBatch(new Date('2026-10-14T16:40:00Z')), null);
  assert.equal(await fallback.maybeRunMissedReminderBatch(new Date('2026-10-17T16:40:00Z')), null); // Saturday
  state.holidays.add('2026-10-15');
  assert.equal(await fallback.maybeRunMissedReminderBatch(new Date('2026-10-15T16:40:00Z')), null);
  assert.equal(await fallback.maybeRunMissedReminderBatch(new Date('2026-10-16T08:10:00Z')), null); // before 08:20
  assert.deepEqual(state.batches, []);
});

test('the dashboard keeps flagging a skipped cron even after the app sent the reminders', async () => {
  reset();
  state.runs = [
    { date: '2026-10-13', reminderType: 'sign_in', source: 'external' },
    { date: '2026-10-13', reminderType: 'sign_out', source: 'app' },
  ];
  const missed = await fallback.getMissedReminderRuns(new Date('2026-10-13T17:00:00Z'));
  assert.deepEqual(missed, [{ label: '4:30 PM sign-out', reminderType: 'sign_out', sentByApp: true }]);
  assert.deepEqual(await fallback.getMissedReminderRuns(new Date('2026-10-17T17:00:00Z')), []);
});

test('check-in and dashboard trigger the fallback after responding; cron routes bypass login', () => {
  const checkIn = read('src', 'app', 'api', 'attendance', 'check-in', 'route.ts');
  const dashboard = read('src', 'app', 'api', 'dashboard', 'route.ts');
  const proxy = read('src', 'proxy.ts');
  const monitor = read('src', 'lib', 'reminder-delivery-monitor.ts');
  assert.match(checkIn, /after\(\(\) => maybeRunMissedReminderBatch\(\)\);/);
  assert.match(dashboard, /after\(\(\) => maybeRunMissedReminderBatch\(\)\);/);
  assert.match(dashboard, /missedReminders,/);
  assert.match(proxy, /'\/api\/attendance\/no-show-sign-in\/apply',/);
  assert.match(monitor, /const missedRun = !isWeekend && !isHoliday && scheduledPassed && !lastRunAt;/);
  assert.match(read('scripts', 'setup-cron-job-org-reminders.mjs'), /LateWatch no sign-in fee 4PM catch-up/);
});

test('reminders are sent at high priority, phones repair themselves, and admins see who cannot receive', () => {
  const pushReminders = read('src', 'lib', 'push-reminders.ts');
  const proofTest = read('src', 'lib', 'push-reminder-proof-test.ts');
  const checkIn = read('src', 'app', 'check-in', 'page.tsx');
  const monitor = read('src', 'lib', 'reminder-delivery-monitor.ts');
  const devices = read('src', 'app', 'attendance', 'devices', 'page.tsx');
  assert.equal((pushReminders.match(/urgency: 'high'/g) || []).length, 2);
  assert.match(proofTest, /urgency: 'high'/);
  assert.match(checkIn, /const reminderRepairAttemptedRef = useRef\(false\);/);
  assert.match(checkIn, /if \(!failing && browserSubscription\?\.endpoint === subscription\.endpoint\) return;/);
  assert.match(checkIn, /\{ refresh: failing, silent: true \}/);
  assert.match(monitor, /selectDistinctOn\(\[pushReminderDelivery\.subscriptionId\]/);
  assert.match(monitor, /cannotReceive,/);
  assert.match(devices, /Won&apos;t get reminders · \{cannotReceive\.length\}/);
});
