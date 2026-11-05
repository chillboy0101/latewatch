/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');

function loadWithMocks(file, mocks) {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, file));
  } finally {
    Module._load = originalLoad;
  }
}

test('page views and speed readings leave without record ids or query strings', () => {
  const { withoutIds } = loadWithMocks('src/components/analytics/vercel-insights.tsx', {
    '@vercel/analytics/next': { Analytics: () => null },
    '@vercel/speed-insights/next': { SpeedInsights: () => null },
  });
  const receipt = withoutIds({ type: 'pageview', url: 'https://latewatch.vercel.app/check-in/receipts/3f1c2b9e-8d7a-4c1b-9e2f-0a1b2c3d4e5f?from=menu#top' });
  assert.deepEqual(receipt, { type: 'pageview', url: 'https://latewatch.vercel.app/check-in/receipts/:id' });
  assert.equal(withoutIds({ type: 'vital', url: 'https://latewatch.vercel.app/check-in?receipts=1', route: '/check-in' }).url, 'https://latewatch.vercel.app/check-in');
  assert.equal(withoutIds({ type: 'pageview', url: 'https://latewatch.vercel.app/' }).url, 'https://latewatch.vercel.app/');
  // Something that isn't an address is passed on unchanged rather than breaking the page.
  assert.deepEqual(withoutIds({ type: 'pageview', url: 'not a url' }), { type: 'pageview', url: 'not a url' });
});

test('Vercel Web Analytics and Speed Insights are on every page', () => {
  const layout = fs.readFileSync(path.join(root, 'src', 'app', 'layout.tsx'), 'utf8');
  const component = fs.readFileSync(path.join(root, 'src', 'components', 'analytics', 'vercel-insights.tsx'), 'utf8');
  assert.match(layout, /<VercelInsights \/>\n\s*<\/body>/);
  assert.match(component, /import \{ Analytics \} from '@vercel\/analytics\/next';/);
  assert.match(component, /import \{ SpeedInsights \} from '@vercel\/speed-insights\/next';/);
  assert.match(component, /<Analytics beforeSend=\{withoutIds\} \/>/);
  assert.match(component, /<SpeedInsights beforeSend=\{withoutIds\} \/>/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@vercel/analytics']);
  assert.ok(pkg.dependencies['@vercel/speed-insights']);
});
