/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const appShellPath = path.join(root, 'src/components/layout/app-shell.tsx');
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
  const appShell = fs.readFileSync(appShellPath, 'utf8');

  assert.match(appShell, /location: 'Office Location'/);
  assert.match(locationPage, /DashboardLayout title="Office Location"/);
  assert.match(locationPage, /export default function LocationPage/);
  assert.match(legacyWifiPage, /from 'next\/navigation'/);
  assert.match(legacyWifiPage, /redirect\('\/location'\)/);
});

test('location page is the map: sign-in area, draw a boundary, and the pin and circle tucked away', () => {
  const locationPage = fs.readFileSync(locationPagePath, 'utf8');

  assert.match(locationPage, /fetch\(`\/api\/attendance\/location\?date=\$\{dateKey\(\)\}`/);
  assert.match(locationPage, /fetch\('\/api\/attendance\/location', \{/);
  assert.match(locationPage, /<OfficeMap\n/);
  assert.match(locationPage, /<h2 className="text-base font-semibold">Sign-in area<\/h2>/);
  assert.match(locationPage, /<h2 className="text-base font-semibold">Draw a boundary<\/h2>/);
  assert.match(locationPage, /<details className="group rounded-lg border border-border bg-card">\n\s+<summary[^>]*>\n\s+Pin and circle/);
  assert.match(locationPage, /\{mode === 'default' \? 'Office' : 'Program'\}/);
  assert.match(locationPage, /Pick on map/);
  // The phone-only measuring page and the check-in shortcut to it are gone.
  assert.equal(fs.existsSync(path.join(root, 'src/app/location/measure')), false);
  assert.doesNotMatch(fs.readFileSync(appShellPath, 'utf8'), /PHONE_ADMIN_PAGES/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/app/check-in/page.tsx'), 'utf8'), /location\/measure|isAdmin/);
});

test('location page uses ultra-minimal copy instead of the old instruction panel', () => {
  const locationPage = fs.readFileSync(locationPagePath, 'utf8');

  assert.doesNotMatch(locationPage, /Stand at the location, detect it, then save/);
  assert.doesNotMatch(locationPage, /Review the name below, then save it for attendance checks/);
  assert.doesNotMatch(locationPage, /Allow location access when the browser asks/);
  assert.doesNotMatch(locationPage, /Detect Current Location/);
  assert.doesNotMatch(locationPage, /Save Location/);
  assert.doesNotMatch(locationPage, /border-dashed/);
  assert.doesNotMatch(locationPage, /export default function WifiPage/);
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
