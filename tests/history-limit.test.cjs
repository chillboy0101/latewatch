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
  let clock = 1_000_000;
  const win = { history, location: { pathname: '/dashboard' } };
  vm.runInNewContext(buildHistoryGuardScript(), {
    Blob: FakeBlob,
    Date: { now: () => clock },
    console: { warn: (...args) => warnings.push(args) },
    navigator: { sendBeacon: (url, blob) => beacons.push({ body: JSON.parse(blob.text), type: blob.type, url }) },
    window: win,
  });

  // Normal updates pass straight through, on the history object, with their arguments.
  assert.equal(history.pushState({ a: 1 }, '', '/x'), 'pushed');
  assert.equal(history.replaceState({ b: 2 }, ''), 'replaced');
  assert.deepEqual(calls.map(([kind, self, state]) => [kind, self === history, state]), [['push', true, { a: 1 }], ['replace', true, { b: 2 }]]);
  // It counts the updates as Safari does, for the app's navigation (see app-nav): in 10-second spans,
  // each starting with the first update after the last span ended.
  assert.equal(win.__latewatchRecentHistoryUpdates(), 2);
  clock += 10_000;
  assert.equal(win.__latewatchRecentHistoryUpdates(), 2);
  clock += 1;
  assert.equal(win.__latewatchRecentHistoryUpdates(), 0);
  history.pushState({}, '');
  clock += 9_000;
  history.pushState({}, '');
  assert.equal(win.__latewatchRecentHistoryUpdates(), 2);
  clock += 1_001;
  assert.equal(win.__latewatchRecentHistoryUpdates(), 0);
  history.pushState({}, '');

  // Safari's limit: skipped quietly (a warning), never thrown at the app.
  mode = 'limit';
  assert.equal(history.pushState({}, ''), undefined);
  assert.equal(history.replaceState({}, ''), undefined);
  assert.equal(warnings.length, 2);
  // Skipped updates don't count: Safari doesn't count them either.
  assert.equal(win.__latewatchRecentHistoryUpdates(), 1);
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('every tap opens its screen at once, except a repeat of one still on its way or near Safari\'s limit', async () => {
  const savedWindow = global.window;
  const savedDocument = global.document;
  const log = [];
  const history = {
    state: null,
    back() { log.push('back'); },
    pushState(state) { this.state = state; log.push(state?.latewatchDeadEnd ? 'push dead end' : 'push'); },
    replaceState(state) { this.state = state; },
  };
  let recentUpdates = 0;
  global.window = {
    __latewatchRecentHistoryUpdates: () => recentUpdates,
    addEventListener() {},
    clearTimeout,
    history,
    location: { pathname: '/' },
    matchMedia: () => ({ matches: false }),
    removeEventListener() {},
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
  };
  global.document = {};
  try {
    const nav = require(path.join(root, 'src', 'lib', 'app-nav.ts'));
    const opened = [];
    const router = { push: (href) => opened.push(href), replace: (href) => opened.push(`replace ${href}`) };
    // The router lands a screen: its entry, then AppPage records it.
    const land = (pathname, state = {}) => {
      history.state = state;
      global.window.location.pathname = pathname;
      nav.recordPathname(pathname);
    };
    const ignored = (reason) => nav.navigationTrail().filter((step) => step.endsWith(`tap ignored (${reason})`)).length;

    land('/', null);
    const homeEntry = history.state;

    // A second tap before the screen has come lands on the screen being left: it opens nothing.
    nav.navigateForward(router, '/dashboard');
    nav.navigateForward(router, '/dashboard');
    nav.navigateReplace(router, '/check-in');
    assert.deepEqual(opened, ['/dashboard']);
    assert.equal(ignored('screen on its way'), 2);

    // Once it is on the page, the next tap goes straight through (no fixed wait).
    land('/dashboard');
    nav.navigateBack(router, '/');
    // A second back before it lands would skip a screen: ignored.
    nav.navigateBack(router, '/');
    assert.deepEqual(log, ['back']);

    // Back on the portal home, a quick tap opens the next screen, and the dead end planned for the
    // portal home is dropped (the new entry drops what was ahead anyway).
    log.length = 0;
    land('/', homeEntry);
    nav.navigateForward(router, '/dashboard');
    assert.deepEqual(opened, ['/dashboard', '/dashboard']);
    land('/dashboard');
    await wait(600);
    assert.deepEqual(log, []);

    // Staying put: the dead end goes in after a moment, and steps back once iOS has its picture.
    nav.navigateBack(router, '/');
    land('/', homeEntry);
    await wait(560);
    assert.deepEqual(log, ['back', 'push dead end']);
    await wait(320);
    assert.deepEqual(log, ['back', 'push dead end', 'back']);

    // A tap while the dead end is still up opens its screen, and the step back is dropped, so it
    // can't undo the new screen.
    log.length = 0;
    history.state = homeEntry;
    land('/dashboard');
    nav.navigateBack(router, '/');
    land('/', homeEntry);
    await wait(560);
    assert.deepEqual(log, ['back', 'push dead end']);
    nav.navigateForward(router, '/dashboard');
    assert.equal(opened.at(-1), '/dashboard');
    await wait(320);
    assert.deepEqual(log, ['back', 'push dead end']);
    land('/dashboard');

    // A screen that takes another's place keeps the screens ahead, so the dead end still goes in.
    log.length = 0;
    nav.navigateBack(router, '/');
    land('/', homeEntry);
    nav.navigateReplace(router, '/check-in');
    land('/check-in');
    await wait(560);
    assert.deepEqual(log, ['back', 'push dead end']);
    await wait(320);
    land('/check-in');

    // Near Safari's limit a tap opens nothing; once older updates have dropped out, taps work again.
    recentUpdates = 92;
    const before = opened.length;
    nav.navigateForward(router, '/dashboard');
    assert.equal(opened.length, before);
    assert.equal(ignored('history limit near'), 1);
    recentUpdates = 91;
    nav.navigateForward(router, '/dashboard');
    assert.equal(opened.length, before + 1);

    // A screen that never comes stops holding taps after a second.
    await wait(1010);
    nav.navigateForward(router, '/check-in');
    assert.equal(opened.at(-1), '/check-in');
  } finally {
    // Back's same-screen watch stops listening a few seconds later: leave it a window to do that on.
    global.window = savedWindow ?? { clearTimeout, removeEventListener() {} };
    global.document = savedDocument;
  }
});
