/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('tsx/cjs');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function link(href, attributes = {}) {
  return {
    closest: (selector) => (selector === 'a[href]' ? link.current : null),
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
    href: new URL(href, 'https://latewatch.example/').href,
    target: attributes.target ?? '',
  };
}

function click(target, extra = {}) {
  return { altKey: false, button: 0, ctrlKey: false, defaultPrevented: false, metaKey: false, shiftKey: false, target, preventDefault() { this.defaultPrevented = true; }, ...extra };
}

test('a tap made while the app is starting opens its screen in place once it is up, not a full reload', () => {
  const { buildEarlyTapScript } = require(path.join(root, 'src', 'lib', 'early-taps.ts'));
  let listener = null;
  const timers = [];
  const assigned = [];
  const win = {
    location: { assign: (url) => assigned.push(url), href: 'https://latewatch.example/', origin: 'https://latewatch.example', pathname: '/' },
  };
  vm.runInNewContext(buildEarlyTapScript(), {
    URL,
    document: { addEventListener: (type, handler, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listener = handler; } },
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
    window: win,
  });

  // Admin Portal tapped as soon as it shows: held, not followed.
  link.current = link('/dashboard');
  const early = click({ closest: () => link.current });
  listener(early);
  assert.equal(early.defaultPrevented, true);
  assert.deepEqual({ ...win.__latewatchEarlyTap, url: undefined }, { href: '/dashboard', nav: 'forward', url: undefined });

  // Links it leaves alone: new tab, other site, this same page, modified clicks, downloads.
  for (const [href, attributes, extra] of [
    ['/staff', { target: '_blank' }, {}],
    ['https://elsewhere.example/x', {}, {}],
    ['/', {}, {}],
    ['/staff', {}, { metaKey: true }],
    ['/export.xlsx', { download: '' }, {}],
  ]) {
    link.current = link(href, attributes);
    const other = click({ closest: () => link.current }, extra);
    listener(other);
    assert.equal(other.defaultPrevented, false, href);
  }

  // A "back" or "replace" card says how it opens.
  link.current = link('/', { 'data-nav': 'back' });
  win.location.pathname = '/dashboard';
  listener(click({ closest: () => link.current }));
  assert.equal(win.__latewatchEarlyTap.nav, 'back');

  // The app comes up and takes the tap, once.
  global.window = win;
  try {
    const { takeEarlyTap } = require(path.join(root, 'src', 'lib', 'early-taps.ts'));
    assert.deepEqual(takeEarlyTap(), { href: '/', nav: 'back' });
    assert.equal(takeEarlyTap(), null);
    assert.equal(win.__latewatchAppReady, true);

    // From then on taps are the app's own.
    link.current = link('/staff');
    const later = click({ closest: () => link.current });
    listener(later);
    assert.equal(later.defaultPrevented, false);

    // The held taps' fallbacks don't fire once the app is up.
    for (const timer of timers) timer.callback();
    assert.deepEqual(assigned, []);

    // Only a path on this site is ever opened ("//host" would leave it).
    win.__latewatchEarlyTap = { href: '//elsewhere.example/x', nav: 'forward' };
    assert.equal(takeEarlyTap(), null);
  } finally {
    delete global.window;
  }
});

test('if the app never comes up, a held tap opens the plain way', () => {
  const { buildEarlyTapScript, EARLY_TAP_FALLBACK_MS } = require(path.join(root, 'src', 'lib', 'early-taps.ts'));
  let listener = null;
  const timers = [];
  const assigned = [];
  const win = { location: { assign: (url) => assigned.push(url), href: 'https://latewatch.example/', origin: 'https://latewatch.example', pathname: '/' } };
  vm.runInNewContext(buildEarlyTapScript(), {
    URL,
    document: { addEventListener: (_type, handler) => { listener = handler; } },
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
    window: win,
  });
  link.current = link('/dashboard');
  listener(click({ closest: () => link.current }));
  assert.equal(timers[0].ms, EARLY_TAP_FALLBACK_MS);
  timers[0].callback();
  assert.deepEqual(assigned, ['https://latewatch.example/dashboard']);
});

test('the early-tap script runs before the app, the app takes the tap, and the cards say how they open', () => {
  const layout = read('src', 'app', 'layout.tsx');
  assert.ok(layout.indexOf('__html: earlyTapScript') > layout.indexOf('<head>'));
  assert.ok(layout.indexOf('__html: earlyTapScript') < layout.indexOf('<body'));
  const page = read('src', 'components', 'layout', 'app-page.tsx');
  assert.match(page, /recordPathname\(pathname\);[\s\S]*const tap = takeEarlyTap\(\);/);
  assert.match(read('src', 'components', 'layout', 'portal-ui.tsx'), /data-nav=\{back \? 'back' : replace \? 'replace' : undefined\}/);
  // The admin portal's phone screen font is ready before it opens.
  assert.match(read('src', 'app', 'page.tsx'), /document\.fonts\?\.load\(`700 44px \$\{handwriting\.style\.fontFamily\}`\)/);
});
