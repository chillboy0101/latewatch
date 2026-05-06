/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { GET: getAttendanceQr } = require('../src/app/api/attendance/qr/route.ts');
const { default: manifest } = require('../src/app/manifest.ts');

test('attendance QR points staff to the install page', async () => {
  const response = await getAttendanceQr();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.checkInUrl, 'https://latewatch.vercel.app/install');
  assert.equal(body.type, 'permanent_install_qr');
  assert.match(body.qrSvg, /<svg/);
});

test('web app manifest opens installed LateWatch at staff check-in with install icons', () => {
  const data = manifest();
  const iconSizes = new Set((data.icons || []).map((icon) => icon.sizes));

  assert.equal(data.start_url, '/check-in');
  assert.equal(data.scope, '/');
  assert.equal(data.display, 'standalone');
  assert.equal(iconSizes.has('192x192'), true);
  assert.equal(iconSizes.has('512x512'), true);
});
