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

test('a screen that breaks reports why and reloads once, then offers a way out', () => {
  const page = read('src', 'app', 'global-error.tsx');
  assert.match(page, /reportClientError\(error\);/);
  // Reload once; if the reload breaks again within 30 s, stay on the message instead of looping.
  assert.match(page, /const RELOAD_AGAIN_AFTER_MS = 30_000;/);
  // The server-made page (Next also builds the static 500 page from it) shows the choices without a script.
  assert.match(page, /const \[stuck\] = useState\(\(\) => typeof window === 'undefined' \|\| reloadedJustNow\(\)\);/);
  assert.match(page, /\{stuck \? \(/);
  assert.match(page, /<p>Reloading…<\/p>/);
  assert.match(page, /if \(stuck\) return;\s*try \{\s*window\.sessionStorage\.setItem\(RELOADED_AT_KEY, String\(Date\.now\(\)\)\);/);
  assert.match(page, /window\.location\.reload\(\);\s*\}, \[error, stuck\]\);/);
  // No storage means no memory of a reload: never reload then, so it can't loop.
  assert.match(page, /\} catch \{\s*\/\/ No storage[^\n]*\n\s*return true;/);
  assert.match(page, /onClick=\{\(\) => window\.location\.reload\(\)\}>Reload</);
  assert.match(page, /onClick=\{\(\) => window\.location\.assign\('\/'\)\}>Portal home</);
  assert.match(page, /<html lang="en">[\s\S]*<body>/);

  const report = read('src', 'lib', 'client-error-report.ts');
  assert.match(report, /navigator\.sendBeacon\('\/api\/client-errors'/);
  assert.match(report, /keepalive: true/);
  assert.match(report, /if \(reported\.has\(error\)\) return;/);
  assert.match(report, /trail: navigationTrail\(\),/);
  assert.match(report, /\} catch \{\s*\/\/ Reporting must never cause a second error\./);
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

test('crash reports are logged for signed-in staff, every field capped', async () => {
  const logged = [];
  const { POST } = loadWithMocks('src/app/api/client-errors/route.ts', {
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
      message: 'x'.repeat(5000),
      name: 'TypeError',
      path: '/dashboard',
      stack: 'y'.repeat(9000),
      trail: Array.from({ length: 40 }, (_, index) => `${index}ms open /dashboard ${'z'.repeat(300)}`),
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
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});
