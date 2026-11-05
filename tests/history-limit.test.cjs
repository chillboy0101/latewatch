/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('tsx/cjs');
const root = path.join(__dirname, '..');

test('past Safari\'s history limit an update is skipped instead of breaking the screen', () => {
  const { buildHistoryGuardScript } = require(path.join(root, 'src', 'lib', 'history-guard.ts'));
  const calls = [];
  let mode = 'ok';
  const history = {
    pushState(...args) {
      calls.push(['push', this, ...args]);
      if (mode === 'limit') throw Object.assign(new Error('Attempt to use history.pushState() more than 100 times per 10 seconds'), { name: 'SecurityError' });
      if (mode === 'other') throw new TypeError('something else');
      return 'pushed';
    },
    replaceState(...args) {
      calls.push(['replace', this, ...args]);
      if (mode === 'limit') throw Object.assign(new Error('Attempt to use history.replaceState() more than 100 times per 10 seconds'), { name: 'SecurityError' });
      return 'replaced';
    },
  };
  const warnings = [];
  const beacons = [];
  class FakeBlob {
    constructor(parts, options) {
      this.text = parts.join('');
      this.type = options.type;
    }
  }
  vm.runInNewContext(buildHistoryGuardScript(), {
    Blob: FakeBlob,
    console: { warn: (...args) => warnings.push(args) },
    navigator: { sendBeacon: (url, blob) => beacons.push({ body: JSON.parse(blob.text), type: blob.type, url }) },
    window: { history, location: { pathname: '/dashboard' } },
  });

  // Normal updates pass straight through, on the history object, with their arguments.
  assert.equal(history.pushState({ a: 1 }, '', '/x'), 'pushed');
  assert.equal(history.replaceState({ b: 2 }, ''), 'replaced');
  assert.deepEqual(calls.map(([kind, self, state]) => [kind, self === history, state]), [['push', true, { a: 1 }], ['replace', true, { b: 2 }]]);

  // Safari's limit: skipped quietly (a warning), never thrown at the app.
  mode = 'limit';
  assert.equal(history.pushState({}, ''), undefined);
  assert.equal(history.replaceState({}, ''), undefined);
  assert.equal(warnings.length, 2);
  // Reported once per page, so the server log shows the limit was reached and handled.
  assert.deepEqual(beacons, [{
    body: { message: 'Attempt to use history.pushState() more than 100 times per 10 seconds', name: 'HistoryLimit', path: '/dashboard' },
    type: 'application/json',
    url: '/api/client-errors',
  }]);

  // Anything else still surfaces.
  mode = 'other';
  assert.throws(() => history.pushState({}, ''), TypeError);

  // It runs before the app: first in the root layout's head.
  const layout = fs.readFileSync(path.join(root, 'src', 'app', 'layout.tsx'), 'utf8');
  assert.ok(layout.indexOf('__html: historyGuardScript') < layout.indexOf('__html: themeScript'));
  assert.ok(layout.indexOf('__html: historyGuardScript') > layout.indexOf('<head>'));
});

test('taps closer than 0.4 s open nothing more', async () => {
  const savedWindow = global.window;
  const savedDocument = global.document;
  global.window = { history: { state: null }, matchMedia: () => ({ matches: false }) };
  global.document = {};
  try {
    const nav = require(path.join(root, 'src', 'lib', 'app-nav.ts'));
    const pushes = [];
    const router = { push: (href) => pushes.push(href), replace: (href) => pushes.push(`replace ${href}`) };
    nav.navigateForward(router, '/dashboard');
    nav.navigateForward(router, '/dashboard');
    nav.navigateReplace(router, '/check-in');
    assert.deepEqual(pushes, ['/dashboard']);
    assert.ok(nav.navigationTrail().some((step) => step.endsWith('tap ignored (too soon)')));
    await new Promise((resolve) => setTimeout(resolve, 420));
    nav.navigateForward(router, '/check-in');
    assert.deepEqual(pushes, ['/dashboard', '/check-in']);
  } finally {
    global.window = savedWindow;
    global.document = savedDocument;
  }
});
