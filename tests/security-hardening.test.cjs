/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

require('tsx/cjs');
const root = path.join(__dirname, '..');

test('every response carries the security headers', async () => {
  const config = require(path.join(root, 'next.config.ts')).default;
  const rules = await config.headers();
  // One rule, for every path.
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');
  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
  // Never inside another site's frame (clickjacking), by the current header and the older one.
  assert.match(headers['Content-Security-Policy'], /(^|;\s*)frame-ancestors 'none'(;|$)/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  // Location stays available to LateWatch itself (sign-in checks); camera and microphone to no one.
  assert.match(headers['Permissions-Policy'], /geolocation=\(self\)/);
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
  assert.match(headers['Permissions-Policy'], /microphone=\(\)/);
});

test('nothing with staff records is served as a public file', () => {
  // Everything in public/, at any depth, can be downloaded by anyone, signed in or not.
  const files = fs.readdirSync(path.join(root, 'public'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(path.join(root, 'public'), path.join(entry.parentPath, entry.name)));
  assert.ok(files.includes('sw.js'), 'the scan reads public/');
  // Spreadsheets and documents of any common kind, data files and archives.
  const records = /\.(xl[a-z]{1,2}|ods|numbers|csv|tsv|json|pdf|docx?|odt|sql|zip|gz)$/i;
  assert.deepEqual(files.filter((file) => records.test(file)), []);
  for (const name of ['book.xlsx', 'book.xls', 'book.xlsm', 'book.xlsb', 'book.ods', 'rows.csv', 'dump.json', 'list.pdf', 'reports/book.XLSX']) {
    assert.ok(records.test(name), name);
  }
  for (const name of ['sw.js', 'latewatch-logo.png', 'file.svg']) assert.ok(!records.test(name), name);
});

test('cron endpoints accept only the exact secret, compared in constant time', () => {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    return originalLoad.call(this, request, ...args);
  };
  const savedSecret = process.env.CRON_SECRET;
  try {
    const { validateReminderCronAuth } = require(path.join(root, 'src', 'lib', 'reminder-cron-guard.ts'));
    const call = (authorization, extra = {}) => validateReminderCronAuth({
      headers: new Headers({ 'user-agent': 'vercel-cron/1.0', ...(authorization === null ? {} : { authorization }), ...extra }),
    });

    process.env.CRON_SECRET = 'correct-horse-battery';
    assert.equal(call('Bearer correct-horse-battery').ok, true);
    for (const wrong of [null, '', 'Bearer ', 'Bearer correct-horse-batter', 'Bearer correct-horse-batteryy', 'bearer correct-horse-battery', 'correct-horse-battery']) {
      const result = call(wrong);
      assert.equal(result.ok, false, String(wrong));
      assert.equal(result.response.status, 401);
    }
    // The right secret from an unknown caller is still refused.
    assert.equal(call('Bearer correct-horse-battery', { 'user-agent': 'curl/8' }).response.status, 403);

    // No secret configured: nobody gets in, not even with an empty one.
    delete process.env.CRON_SECRET;
    assert.equal(call('Bearer ').ok, false);
    assert.equal(call('Bearer undefined').ok, false);

    const guard = fs.readFileSync(path.join(root, 'src', 'lib', 'reminder-cron-guard.ts'), 'utf8');
    assert.match(guard, /timingSafeEqual\(/);
    assert.doesNotMatch(guard, /authHeader\s*!==/);
  } finally {
    Module._load = originalLoad;
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  }
});

test('an address that leads nowhere gets a LateWatch page with a way back', () => {
  const page = fs.readFileSync(path.join(root, 'src', 'app', 'not-found.tsx'), 'utf8');
  assert.match(page, /export default function NotFound\(/);
  assert.match(page, /<Link href="\/">Main portal<\/Link>/);
});
