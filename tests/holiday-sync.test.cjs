/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

require('tsx/cjs');
const { parseHolidayFeed, publicHolidaysFrom } = require(path.join(root, 'src/lib/google-calendar.ts'));

function loadSync() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (request === '@/db') return { db: {} };
    if (request === '@/lib/audit') return { tryWriteAuditEvent: async () => null };
    if (request === '@/lib/realtime') return { publishRealtime: () => null };
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, 'src/lib/holiday-sync.ts'));
  } finally {
    Module._load = originalLoad;
  }
}
const { planHolidaySync } = loadSync();

// The shape of Google's public holiday feed (folded lines, escaped text, observance labels).
const SAMPLE_FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270101',
  'DTEND;VALUE=DATE:20270102',
  'SUMMARY:New Year\'s Day',
  'DESCRIPTION:Public holiday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270208',
  'SUMMARY:Ramadan Start (tentative)',
  'DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setti',
  ' ngs > Holidays in Ghana',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270310',
  'SUMMARY:Eid ul-Fitr (tentative)',
  'DESCRIPTION:Public holiday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261225',
  'SUMMARY:Christmas Day',
  'DESCRIPTION:Public holiday',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('the public feed is parsed and observances are left out', () => {
  const events = parseHolidayFeed(SAMPLE_FEED);
  assert.deepEqual(events.map((event) => [event.date, event.observance]), [
    ['2026-12-25', false],
    ['2027-01-01', false],
    ['2027-02-08', true],
    ['2027-03-10', false],
  ]);
  assert.deepEqual(publicHolidaysFrom(events, 2027).map((holiday) => holiday.date), ['2027-01-01', '2027-03-10']);
});

test('a sync adds and restores listed holidays and drops unlisted Google ones, today onwards only', () => {
  const row = (date, extra) => ({ date, holidayNote: 'x', id: `id-${date}`, isHoliday: true, isRemoved: false, source: 'google', ...extra });
  const changes = planHolidaySync({
    existing: [
      row('2026-01-07'), // past and unlisted: left alone
      row('2027-02-08', { holidayNote: 'Ramadan Start (tentative)' }), // observance: dropped
      row('2027-03-09', { holidayNote: 'Eid ul-Fitr (tentative)' }), // moved: dropped
      row('2027-03-10', { isHoliday: false }), // listed again: restored
      row('2027-04-29', { source: 'manual' }), // added by an admin: kept
      row('2027-12-24', { isRemoved: true }), // removed by an admin: kept
    ],
    holidays: [
      { date: '2027-01-01', name: "New Year's Day" },
      { date: '2027-03-10', name: 'Eid ul-Fitr' },
    ],
    today: '2026-10-14',
  });
  assert.deepEqual(changes.map((change) => [change.action, change.date]), [
    ['add', '2027-01-01'],
    ['drop', '2027-02-08'],
    ['drop', '2027-03-09'],
    ['restore', '2027-03-10'],
  ]);
});

test('an empty or broken feed changes nothing', () => {
  const existing = [{ date: '2027-02-08', holidayNote: 'x', id: 'a', isHoliday: true, isRemoved: false, source: 'google' }];
  assert.deepEqual(planHolidaySync({ existing, holidays: [], today: '2026-10-14' }), []);
});

test('the monthly cron syncs this year and next, behind the cron secret', () => {
  const route = read('src', 'app', 'api', 'calendar', 'sync', 'monthly', 'route.ts');
  const proxy = read('src', 'proxy.ts');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(route, /const guard = validateReminderCronAuth\(request\);\s*if \(!guard\.ok\) return guard\.response;/);
  assert.match(route, /years: \[year, year \+ 1\]/);
  assert.match(proxy, /'\/api\/calendar\/sync\/monthly',/);
  assert.ok(vercel.crons.some((cron) => cron.path === '/api/calendar/sync/monthly' && cron.schedule === '0 3 1 * *'));
  assert.doesNotMatch(read('src', 'lib', 'google-calendar.ts'), /googleapis|GOOGLE_CALENDAR_API_KEY/);
});
