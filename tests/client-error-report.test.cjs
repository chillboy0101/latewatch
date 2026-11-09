/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

require('tsx/cjs');

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

test('a screen that breaks reports why and reloads once, then offers a way out', () => {
  const page = read('src', 'app', 'global-error.tsx');
  assert.match(page, /reportClientError\(error\);/);
  assert.match(page, /if \(mayReloadAfterCrash\(\)\) window\.location\.reload\(\);\s*\}, \[error\]\);/);
  // The same markup on the server and in the browser: the choices, as plain links (no script needed).
  assert.doesNotMatch(page, /useState|Reloading/);
  assert.match(page, /<a className="button" href="">Reload<\/a>/);
  assert.match(page, /<a className="button plain" href="\/">Portal home<\/a>/);
  assert.match(page, /<html lang="en">[\s\S]*<body>/);

  const report = read('src', 'lib', 'client-error-report.ts');
  assert.match(report, /navigator\.sendBeacon\('\/api\/client-errors'/);
  assert.match(report, /keepalive: true/);
  assert.match(report, /if \(reported\.has\(error\)\) return;/);
  assert.match(report, /message: clip\(String\(error\?\.message \?\? error\), 1000\),/);
  assert.match(report, /trail: navigationTrail\(\)\.map\(\(step\) => step\.slice\(0, 120\)\),/);
  assert.match(report, /\} catch \{\s*\/\/ Reporting must never cause a second error\./);
});

test('the crash screen reloads only once, and only when it can remember doing so', () => {
  const savedWindow = global.window;
  const store = new Map();
  let failWrites = false;
  let noStorage = false;
  global.window = {
    get sessionStorage() {
      if (noStorage) throw new Error('blocked');
      return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
          if (failWrites) throw new Error('quota');
          store.set(key, value);
        },
      };
    },
  };
  try {
    const { mayReloadAfterCrash } = require(path.join(root, 'src', 'lib', 'client-error-report.ts'));
    assert.equal(mayReloadAfterCrash(), true); // first crash: reload
    assert.equal(mayReloadAfterCrash(), false); // breaks again straight after: stay
    store.clear();
    failWrites = true;
    assert.equal(mayReloadAfterCrash(), false); // can't remember the reload: never risk a loop
    failWrites = false;
    noStorage = true;
    assert.equal(mayReloadAfterCrash(), false); // no storage at all: stay
  } finally {
    global.window = savedWindow;
  }
});

test('the server-made error page (also the static 500 page) shows the choices without a script', () => {
  require('tsx/cjs');
  const React = require('react');
  const { renderToString } = require('react-dom/server');
  const GlobalError = require(path.join(root, 'src', 'app', 'global-error.tsx')).default;
  const html = renderToString(React.createElement(GlobalError, { error: new Error('boom'), unstable_retry() {} }));
  assert.ok(html.includes('Something went wrong'));
  assert.ok(html.includes('>Reload<'));
  assert.ok(html.includes('Portal home'));
  assert.ok(!html.includes('Reloading'));
});

test('navigation steps are kept for a crash report', () => {
  const nav = read('src', 'lib', 'app-nav.ts');
  assert.match(nav, /if \(trail\.length > 16\) trail\.shift\(\);/);
  for (const step of ["note(`open ${href}`)", "note(`open ${href} in place`)", "note('dead end added')", 'note(`history moved to']) {
    assert.ok(nav.includes(step), step);
  }
});

test('crash reports are logged for signed-in staff, every field capped, big bodies refused', async () => {
  const logged = [];
  const limitKeys = [];
  let allowed = true;
  const { POST } = loadWithMocks('src/app/api/client-errors/route.ts', {
    '@/lib/rate-limit': {
      allowRequest: async (key, limit, windowSeconds) => {
        limitKeys.push([key, limit, windowSeconds]);
        return allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 42 };
      },
    },
    '@clerk/nextjs/server': { auth: async () => ({ userId: 'user_1' }) },
  });
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const request = (body, headers = {}) => new Request('http://localhost/api/client-errors', {
      body,
      headers: { 'content-type': 'application/json', 'user-agent': 'iPhone Safari', ...headers },
      method: 'POST',
    });
    const response = await POST(request(JSON.stringify({
      message: 'x'.repeat(3000),
      name: 'TypeError',
      path: '/dashboard',
      stack: 'y'.repeat(6000),
      trail: Array.from({ length: 20 }, (_, index) => `${index}ms open /dashboard ${'z'.repeat(150)}`),
    })));
    assert.equal(response.status, 204);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], '[client-error]');
    const entry = JSON.parse(logged[0][1]);
    assert.equal(entry.message.length, 500);
    assert.equal(entry.stack.length, 2000);
    assert.equal(entry.trail.length, 16);
    assert.ok(entry.trail.every((step) => step.length <= 120));
    assert.equal(entry.userId, 'user_1');
    assert.equal(entry.userAgent, 'iPhone Safari');

    // Not a report: nothing logged.
    assert.equal((await POST(request('not json'))).status, 204);
    assert.equal((await POST(request('[1,2]'))).status, 204);
    // Far bigger than any report: refused before it is parsed, by declared size or by the bytes sent.
    assert.equal((await POST(request(JSON.stringify({ message: 'x'.repeat(20000) })))).status, 413);
    assert.equal((await POST(request('{}', { 'content-length': '999999' }))).status, 413);
    assert.equal(logged.length, 1);

    // Each account may send only a few a minute: past that a report is turned away, unlogged.
    assert.deepEqual(limitKeys, [['client-errors:user_1', 10, 60]]);
    allowed = false;
    const limited = await POST(request(JSON.stringify({ message: 'again' })));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '42');
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});
