/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('tsx/cjs');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Main Portal in the admin sidebar slides back to the portal home', () => {
  const sidebar = read('src', 'components', 'layout', 'sidebar.tsx');
  assert.match(sidebar, /aria-label="Main Portal"[\s\S]*?onClick=\{\(event\) => \{\n\s*if \(!isPlainClick\(event\)\) return;\n\s*event\.preventDefault\(\);\n\s*appNavigation\.home\(\);/);
  // The slide back is the "back" one, the mirror of Admin Portal's slide in.
  assert.match(read('src', 'lib', 'app-nav.ts'), /slideTo\('back', \(\) => router\.push\('\/'\)\);/);
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
  // No view transitions here: the navigation runs straight away (slideTo).
  global.document = {};
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
  } finally {
    global.window = savedWindow ?? { clearTimeout, removeEventListener() {} };
    global.document = savedDocument;
  }
});
