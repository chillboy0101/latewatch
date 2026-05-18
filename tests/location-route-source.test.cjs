/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const locationPagePath = path.join(root, 'src/app/location/page.tsx');
const legacyWifiPagePath = path.join(root, 'src/app/wifi/page.tsx');
const notificationsPath = path.join(root, 'src/app/api/notifications/route.ts');
const proxyPath = path.join(root, 'src/proxy.ts');
const robotsPath = path.join(root, 'src/app/robots.ts');
const sidebarPath = path.join(root, 'src/components/layout/sidebar.tsx');

test('office location admin page uses the location route with a protected wifi redirect', () => {
  assert.equal(fs.existsSync(locationPagePath), true);
  assert.equal(fs.existsSync(legacyWifiPagePath), true);

  const locationPage = fs.readFileSync(locationPagePath, 'utf8');
  const legacyWifiPage = fs.readFileSync(legacyWifiPagePath, 'utf8');

  assert.match(locationPage, /DashboardLayout title="Office Location"/);
  assert.match(legacyWifiPage, /from 'next\/navigation'/);
  assert.match(legacyWifiPage, /redirect\('\/location'\)/);
});

test('location navigation and notifications point to /location instead of /wifi', () => {
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const notifications = fs.readFileSync(notificationsPath, 'utf8');

  assert.match(sidebar, /name: 'Location', href: '\/location'/);
  assert.doesNotMatch(sidebar, /href: '\/wifi'/);
  assert.match(notifications, /case 'office_network':\s*return '\/location';/);
  assert.doesNotMatch(notifications, /return '\/wifi'/);
});

test('location route is protected while wifi remains only as a legacy redirect route', () => {
  const proxy = fs.readFileSync(proxyPath, 'utf8');
  const robots = fs.readFileSync(robotsPath, 'utf8');

  assert.match(proxy, /'\/location\(\.\*\)'/);
  assert.match(proxy, /'\/wifi\(\.\*\)'/);
  assert.match(robots, /"\/location\/"/);
  assert.doesNotMatch(robots, /"\/wifi\/"/);
});
