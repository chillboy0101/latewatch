/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function loadWithMocks(file, mocks) {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, file));
  } finally {
    Module._load = originalLoad;
  }
}

const published = [];
const realtime = loadWithMocks('src/lib/realtime.ts', {
  '@/lib/ably-channel': {
    ablyPublish: async (channel, name, data) => {
      published.push({ channel, data, name });
    },
  },
});

test('shared staff channels never say who an update is about, whatever the caller sends', () => {
  published.length = 0;
  const streamed = [];
  const unregister = realtime.registerRealtimeClient('notifications', { close() {}, send: (text) => streamed.push(text) });
  try {
    realtime.publishRealtime('notifications', 'invalidate', {
      action: 'UPDATE', auditEventId: 'audit-1', entityId: 'staff-1', reason: 'audit', staffId: 'staff-1', userId: 'user_1',
    });
    realtime.publishRealtime('attendance', 'invalidate', { date: '2026-11-05', personal: true, reason: 'x', reminderType: 'sign_in' });
    realtime.publishRealtime('staff-penalty-history', 'invalidate', 'staff-1');
    realtime.publishRealtime('payments', 'invalidate', { reason: 'lateness-payment', staffId: 'staff-1' });
  } finally {
    unregister();
  }

  assert.deepEqual(published, [
    { channel: 'latewatch:notifications', data: { reason: 'audit' }, name: 'invalidate' },
    { channel: 'latewatch:attendance', data: { date: '2026-11-05', personal: true, reason: 'x', reminderType: 'sign_in' }, name: 'invalidate' },
    { channel: 'latewatch:staff-penalty-history', data: undefined, name: 'invalidate' },
    // Admin-only channels are unchanged.
    { channel: 'latewatch:payments', data: { reason: 'lateness-payment', staffId: 'staff-1' }, name: 'invalidate' },
  ]);
  // The fallback stream sends the same trimmed update.
  assert.deepEqual(streamed, ['event: invalidate\ndata: {"reason":"audit"}\n\n']);
});

test('an update about one person goes in full only to their own channel', () => {
  published.length = 0;
  realtime.publishStaffUpdate('staff-1', ['attendance', 'payments', 'staff-penalty-history'], { date: '2026-11-05', reason: 'attendance-sign-out' });

  assert.deepEqual(published, [
    { channel: 'latewatch:attendance', data: { date: '2026-11-05', personal: true, reason: 'attendance-sign-out' }, name: 'invalidate' },
    { channel: 'latewatch:staff:staff-1', data: { date: '2026-11-05', reason: 'attendance-sign-out' }, name: 'attendance' },
    { channel: 'latewatch:payments', data: { date: '2026-11-05', personal: true, reason: 'attendance-sign-out', staffId: 'staff-1' }, name: 'invalidate' },
    { channel: 'latewatch:staff-penalty-history', data: { date: '2026-11-05', personal: true, reason: 'attendance-sign-out' }, name: 'invalidate' },
    { channel: 'latewatch:staff:staff-1', data: { date: '2026-11-05', reason: 'attendance-sign-out' }, name: 'staff-penalty-history' },
  ]);
});

test('no publish on a staff channel names a person', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));

  const offenders = [];
  for (const file of files) {
    // The choke point itself (tested above) is the only place allowed to handle ids for staff channels.
    if (file.endsWith(path.join('src', 'lib', 'realtime.ts'))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/publishRealtime\(([\s\S]*?)\);/g)) {
      const args = match[1];
      if (/staffId|userId/.test(args) && !/^'(payments|entries|dashboard|audit-trail)'/.test(args.trim())) {
        offenders.push(`${path.relative(root, file)}: publishRealtime(${args.slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('staff hear their own channel: chosen by the login, never by the browser', async () => {
  let signedIn = null;
  let member = null;
  let lookupFails = false;
  let admin = false;
  let lookups = 0;
  const { GET: token } = loadWithMocks('src/app/api/realtime/token/route.ts', {
    '@clerk/nextjs/server': { currentUser: async () => signedIn },
    '@/lib/auth/roles': { enforceRole: async () => (admin ? null : { error: 'Forbidden', status: 403 }) },
    '@/lib/auth/signed-in-staff': {
      getSignedInStaff: async () => {
        lookups += 1;
        if (lookupFails) throw new Error('database down');
        return member;
      },
    },
    ably: {
      Rest: class {
        constructor() {
          this.auth = { createTokenRequest: async (params) => params };
        }
      },
    },
  });
  const previousKey = process.env.ABLY_API_KEY;
  process.env.ABLY_API_KEY = 'test.key:secret';
  const originalError = console.error;
  console.error = () => {};
  try {
    signedIn = { id: 'user_1' };
    member = { id: 'staff-1' };
    const own = await (await token()).json();
    assert.deepEqual(Object.keys(own.capability).sort(), [
      'latewatch:attendance',
      'latewatch:notifications',
      'latewatch:staff-penalty-history',
      'latewatch:staff:staff-1',
      'latewatch:user-theme:user_1',
    ]);
    assert.ok(Object.values(own.capability).every((ops) => ops.length === 1 && ops[0] === 'subscribe'));

    // A failed lookup still gives a token, just without the person's own channel.
    lookupFails = true;
    const withoutOwn = await (await token()).json();
    assert.equal(Object.keys(withoutOwn.capability).some((channel) => channel.startsWith('latewatch:staff:')), false);
    lookupFails = false;

    admin = true;
    lookups = 0;
    assert.deepEqual((await (await token()).json()).capability, { 'latewatch:*': ['subscribe'] });
    assert.equal(lookups, 0);
  } finally {
    console.error = originalError;
    if (previousKey === undefined) delete process.env.ABLY_API_KEY;
    else process.env.ABLY_API_KEY = previousKey;
  }

  const registered = [];
  const { GET: stream } = loadWithMocks('src/app/api/realtime/me/route.ts', {
    '@clerk/nextjs/server': { currentUser: async () => signedIn },
    '@/lib/auth/signed-in-staff': { getSignedInStaff: async () => member },
    '@/lib/realtime': {
      registerRealtimeClient: (channel) => {
        registered.push(channel);
        return () => {};
      },
    },
  });
  signedIn = null;
  assert.equal((await stream()).status, 401);
  signedIn = { id: 'user_1' };
  member = null;
  assert.equal((await stream()).status, 403);
  member = { id: 'staff-1' };
  const response = await stream();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.deepEqual(registered, ['staff:staff-1']);
  await response.body.cancel();
});

test('admin-only fallback streams refuse staff; the shared staff ones stay open to them', () => {
  for (const channel of ['dashboard', 'entries', 'payments', 'audit-trail']) {
    const route = read('src', 'app', 'api', 'realtime', channel, 'route.ts');
    const gate = route.indexOf("const authError = await enforceRole(['admin']);");
    assert.ok(gate > 0 && gate < route.indexOf('new ReadableStream'), channel);
    assert.match(route, /if \(authError\) return NextResponse\.json\(\{ error: authError\.error \}, \{ status: authError\.status \}\);/);
  }
  for (const channel of ['attendance', 'notifications']) {
    assert.doesNotMatch(read('src', 'app', 'api', 'realtime', channel, 'route.ts'), /enforceRole/);
  }
});

test('the check-in page listens to its own channel and refreshes what that channel stands for', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  const client = read('src', 'lib', 'realtime-client.ts');
  const ownChannel = page.slice(page.indexOf('channel: staffMemberChannel(myStaffId)'));
  assert.match(page, /const myStaffId = status\?\.staff\?\.id \?\? null;/);
  assert.match(page, /if \(!isLoaded \|\| !user \|\| !myStaffId\) return;/);
  assert.match(ownChannel, /^channel: staffMemberChannel\(myStaffId\),\s*events: \[\.\.\.STAFF_CHANNELS\],/);
  assert.match(ownChannel, /if \(event === 'staff-penalty-history'\) \{\s*void fetchReceiptNotifications\(\);\s*if \(penaltyOnScreenRef\.current\) void fetchPenaltyHistory\(\{ fresh: true \}\);\s*return;\s*\}\s*void fetchStatus\(\{ preserveMessage: true, silent: true \}\);\s*void fetchPushReminderStatus\(\{ silent: true \}\);/);
  assert.match(ownChannel, /ssePath: OWN_CHANNEL_STREAM_PATH,/);
  assert.match(client, /new EventSource\(ssePath \?\? `\/api\/realtime\/\$\{channel\}`\)/);
});
