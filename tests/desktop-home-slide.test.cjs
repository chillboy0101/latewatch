/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('tsx/cjs');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Main Portal in the admin sidebar goes home through the app (not a plain link)', () => {
  // Only the wiring is checked here, loosely (formatting may change); the behaviour is tested below.
  const sidebar = read('src', 'components', 'layout', 'sidebar.tsx');
  const link = sidebar.slice(sidebar.indexOf('aria-label="Main Portal"'));
  assert.match(link, /onClick=\{[\s\S]*?isPlainClick\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?appNavigation\.home\(\)/);
});

test('Main Portal steps back when the portal home is the screen before, else opens it afresh', () => {
  const savedWindow = global.window;
  const savedDocument = global.document;
  const log = [];
  const history = {
    state: null,
    back() { log.push('back'); },
    pushState(state) { this.state = state; },
    replaceState(state) { this.state = state; },
  };
  global.window = {
    addEventListener() {},
    clearTimeout,
    history,
    location: { pathname: '/' },
    matchMedia: () => ({ matches: false }),
    removeEventListener() {},
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
  };
  // A browser with view transitions (a computer): each slide's direction is recorded as it starts.
  const slides = [];
  const html = { dataset: {} };
  global.document = {
    documentElement: html,
    startViewTransition(update) {
      slides.push(html.dataset.nav);
      const done = Promise.resolve(update());
      return { finished: done, ready: done, skipTransition() {} };
    },
  };
  try {
    const nav = require(path.join(root, 'src', 'lib', 'app-nav.ts'));
    const router = { push: (href) => log.push(`push ${href}`), replace: (href) => log.push(`replace ${href}`) };
    const land = (pathname, state = {}) => {
      history.state = state;
      global.window.location.pathname = pathname;
      nav.recordPathname(pathname);
    };

    // Portal home → Admin Portal → Main Portal: one step back.
    land('/', null);
    land('/dashboard');
    nav.navigateHome(router);
    assert.deepEqual(log, ['back']);
    // The "back" slide, the mirror of Admin Portal's slide in.
    assert.deepEqual(slides, ['back']);
    land('/', null);

    // Portal home → Admin Portal → Staff → Main Portal: the portal home opens afresh (a new entry,
    // which starts the stack again), not a step back to the dashboard.
    log.length = 0;
    land('/', null);
    land('/dashboard');
    land('/staff');
    nav.navigateHome(router);
    assert.deepEqual(log, ['push /']);
    land('/');
    assert.equal(nav.canGoBack(), false);
    // Again the "back" slide, though it opens the portal home afresh.
    assert.deepEqual(slides, ['back', 'back']);
  } finally {
    global.window = savedWindow ?? { clearTimeout, removeEventListener() {} };
    global.document = savedDocument;
  }
});
