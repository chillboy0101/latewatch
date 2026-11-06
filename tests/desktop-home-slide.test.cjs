/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('tsx/cjs');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The Main Portal link alone (up to its closing tag), without comments, so a commented-out call or
// a handler on some later element can't stand in for it.
function mainPortalLink() {
  const sidebar = read('src', 'components', 'layout', 'sidebar.tsx');
  const start = sidebar.indexOf('aria-label="Main Portal"');
  assert.notEqual(start, -1, 'the sidebar has a Main Portal link');
  const end = sidebar.indexOf('</Link>', start);
  assert.notEqual(end, -1, 'the Main Portal link closes');
  return sidebar.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('Main Portal in the admin sidebar goes home through the app; modified clicks stay plain links', () => {
  // The wiring, whatever the formatting: a plain click goes through navigateHome (tested below); a
  // modified one (new tab, Cmd/Ctrl-click) is left to the link.
  assert.match(mainPortalLink(), /onClick=\{\s*\(event\)\s*=>\s*\{\s*if\s*\(\s*!\s*isPlainClick\(\s*event\s*\)\s*\)\s*return\s*;?\s*event\.preventDefault\(\s*\)\s*;?\s*appNavigation\.home\(\s*\)\s*;?\s*\}\s*\}/);
});

// A browser for app-nav. With view transitions (a computer), each slide records its direction as it
// starts and runs its update a moment later, as browsers do; without them (reduced motion, iPhones
// and iPads, older browsers) the navigation runs straight away.
function browser({ viewTransitions }) {
  const log = [];
  const slides = [];
  const history = {
    state: null,
    back() { log.push('back'); },
    pushState(state) { this.state = state; log.push(state?.latewatchDeadEnd ? 'push dead end' : 'push'); },
    replaceState(state) { this.state = state; },
  };
  // Timers that never hold the test run open (back's same-screen watch waits 3 s).
  const later = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return timer;
  };
  const window = {
    addEventListener() {},
    clearTimeout,
    history,
    location: { pathname: '/' },
    matchMedia: () => ({ matches: false }),
    removeEventListener() {},
    requestAnimationFrame: (callback) => later(callback, 0),
    setTimeout: later,
  };
  const html = { dataset: {} };
  const document = viewTransitions
    ? {
      documentElement: html,
      startViewTransition(update) {
        const slide = { direction: html.dataset.nav, settled: false };
        slides.push(slide);
        const finished = Promise.resolve().then(update).then(() => { slide.settled = true; });
        return { finished, ready: finished, skipTransition() {} };
      },
    }
    : {};
  return { document, history, log, slides, window };
}

// A computer, not an iPhone or iPad (slideTo checks), on any Node version.
function asComputer() {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    writable: true,
  });
  return () => {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  };
}

function withBrowser(options, run) {
  return async () => {
    const savedWindow = global.window;
    const savedDocument = global.document;
    const restoreNavigator = asComputer();
    const env = browser(options);
    global.window = env.window;
    global.document = env.document;
    const nav = require(path.join(root, 'src', 'lib', 'app-nav.ts'));
    try {
      await run(nav, env);
    } finally {
      nav.cancelPendingDeadEnd();
      global.window = savedWindow ?? { clearTimeout, removeEventListener() {} };
      global.document = savedDocument;
      restoreNavigator();
    }
  };
}

for (const viewTransitions of [true, false]) {
  test(`Main Portal steps back when the portal home is the screen before, else opens it afresh (${viewTransitions ? 'with' : 'without'} view transitions)`, withBrowser({ viewTransitions }, async (nav, { history, log, slides, window }) => {
    const router = { push: (href) => log.push(`router push ${href}`), replace: (href) => log.push(`router replace ${href}`) };
    // The router lands a screen: its history entry, then AppPage records it.
    const land = (pathname, state = {}) => {
      history.state = state;
      window.location.pathname = pathname;
      nav.recordPathname(pathname);
    };

    // Portal home → Admin Portal → Main Portal: one step back, onto the portal home's own entry.
    land('/', null);
    const homeEntry = history.state;
    land('/dashboard');
    nav.navigateHome(router);
    await tick();
    assert.deepEqual(log, ['back']);
    land('/', homeEntry);
    assert.equal(nav.canGoBack(), false);
    if (viewTransitions) {
      // The "back" slide, the mirror of Admin Portal's slide in, finished by the screen landing.
      await tick();
      assert.deepEqual(slides.map((slide) => [slide.direction, slide.settled]), [['back', true]]);
    }
    // Then, as after any step back, the swipe-forward dead end goes in.
    await wait(560);
    assert.deepEqual(log, ['back', 'push dead end']);
    nav.cancelPendingDeadEnd();

    // Portal home → Admin Portal → Staff → Main Portal: the portal home opens afresh (a new entry,
    // which starts the stack again), not a step back to the dashboard.
    log.length = 0;
    slides.length = 0;
    land('/', null);
    land('/dashboard');
    land('/staff');
    nav.navigateHome(router);
    await tick();
    assert.deepEqual(log, ['router push /']);
    land('/');
    assert.equal(nav.canGoBack(), false);
    if (viewTransitions) {
      // Again the "back" slide, though it opens the portal home afresh.
      await tick();
      assert.deepEqual(slides.map((slide) => [slide.direction, slide.settled]), [['back', true]]);
    }
  }));
}

test('a newer slide is finished by its own screen, even after an older, slow one gives up', withBrowser({ viewTransitions: true }, async (nav, { history, slides, window }) => {
  const router = { push() {}, replace() {} };
  const land = (pathname, state = {}) => {
    history.state = state;
    window.location.pathname = pathname;
    nav.recordPathname(pathname);
  };
  // Each slide's 1.5 s give-up is held and fired by hand, so the order below is exact on any machine.
  const giveUps = [];
  const later = window.setTimeout;
  window.setTimeout = (callback, ms) => {
    if (ms !== 1500) return later(callback, ms);
    giveUps.push(callback);
    return later(() => {}, 0);
  };
  land('/', null);
  // Slide A: its screen is slow and never comes. After a second taps go through again (real time:
  // the hold reads the clock), so slide B starts.
  nav.navigateForward(router, '/dashboard');
  await wait(1050);
  nav.navigateForward(router, '/check-in');
  await tick();
  assert.equal(slides.length, 2);
  assert.equal(giveUps.length, 2);
  // A gives up while B is still on its way; then B's screen lands.
  giveUps[0]();
  land('/check-in');
  await tick();
  // B finishes as its screen lands (not held until its own give-up).
  assert.equal(slides[1].settled, true);
}));
