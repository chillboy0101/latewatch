#!/usr/bin/env node
// Local UI harness: screenshots signed-in pages at phone and desktop sizes without Clerk or the
// database. It starts `next dev` with LATEWATCH_UI_HARNESS=1 (next.config.ts then swaps Clerk's
// client package for tests/ui/clerk-mock.tsx) and answers every /api call with made-up data
// from tests/ui/fixtures.mjs. Screenshots land in output/ui-shots/.
//
//   npm run ui:shots

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildFixtures } from '../tests/ui/fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'ui-shots');
const port = Number(process.env.UI_SHOTS_PORT || 3100);
const baseUrl = `http://localhost:${port}`;

// UI_SHOTS_SCHEME=dark takes the same screenshots in dark mode (files get a "dark-" prefix).
const SCHEME = process.env.UI_SHOTS_SCHEME === 'dark' ? 'dark' : 'light';
const PHONE = { colorScheme: SCHEME, deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } };
const DESKTOP = { colorScheme: SCHEME, viewport: { height: 800, width: 1280 } };

function startServer() {
  const env = {
    ...process.env,
    CLERK_SECRET_KEY: '',
    DATABASE_URL: '',
    DATABASE_URL_UNPOOLED: '',
    LATEWATCH_UI_HARNESS: '1',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    NODE_ENV: 'development',
  };
  delete env.VERCEL;
  // Own process group, so stopping it also stops the dev server's workers.
  const server = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(port)], {
    cwd: root,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.env.UI_SHOTS_VERBOSE && process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.env.UI_SHOTS_VERBOSE && process.stderr.write(chunk));
  return server;
}

async function waitForServer(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/check-in`, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev did not start on ${baseUrl}`);
}

async function mockApi(context) {
  const fixtures = buildFixtures();
  await context.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    // No live updates in the harness: realtime answers "unavailable" and pages stay on the fixtures.
    if (pathname.startsWith('/api/realtime')) {
      return route.fulfill({ body: JSON.stringify({ error: 'Realtime is off in the UI harness' }), contentType: 'application/json', status: 503 });
    }
    const body = fixtures[pathname] ?? {};
    return route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status: 200 });
  });
}

async function shoot(page, name) {
  await page.waitForTimeout(600);
  const file = path.join(outDir, `${SCHEME === 'dark' ? 'dark-' : ''}${name}.png`);
  await page.screenshot({ path: file });
  console.log(`saved ${path.relative(root, file)}`);
}

async function phoneShots(browser) {
  const context = await browser.newContext(PHONE);
  await mockApi(context);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/check-in`, { waitUntil: 'load' });
  await page.getByRole('dialog', { name: /reminders/i }).waitFor({ timeout: 60_000 });
  await shoot(page, 'phone-check-in-reminder-popup');
  await page.getByRole('button', { name: 'Not now' }).click();
  await shoot(page, 'phone-check-in');

  await page.getByRole('button', { name: 'More' }).click();
  await shoot(page, 'phone-check-in-menu');
  await page.getByRole('button', { name: 'Penalty history' }).click();
  await shoot(page, 'phone-penalty-history');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Payment receipts/ }).click();
  await shoot(page, 'phone-receipts');
  await page.getByRole('button', { name: /GHC 10\.00/ }).first().click();
  await page.waitForTimeout(1500);
  await shoot(page, 'phone-receipt-detail');
  await page.getByRole('button', { name: 'Back to receipts' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Reminders' }).click();
  await shoot(page, 'phone-reminders');
  await context.close();
}

// Office Location on a desktop: the map with a proposed area, then editing it.
async function locationShots(browser) {
  const check = (condition, message) => {
    if (!condition) throw new Error(`Office Location check failed: ${message}`);
  };
  const context = await browser.newContext(DESKTOP);
  await mockApi(context);
  const page = await context.newPage();
  const saved = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/attendance/location/boundary')) saved.push(request.postDataJSON());
  });
  // Place search goes to OpenStreetMap; here it answers with one made-up place.
  await context.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({
    body: JSON.stringify([{ display_name: 'Alisa Hotel, North Ridge, Accra, Ghana', lat: '5.5662', lon: '-0.1990', name: 'Alisa Hotel' }]),
    contentType: 'application/json',
  }));
  await page.goto(`${baseUrl}/location`, { waitUntil: 'load' });
  // Satellite tiles may not load in the harness; the lines and corners still show.
  const map = page.getByRole('application', { name: 'Satellite map of the office grounds' });
  await map.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  check(await map.evaluate((node) => node.classList.contains('leaflet-container')), 'the map loads');
  check(await page.getByText(/The pin moves to its centre, with a \d+ m backup circle round every edge\./).count() === 1, 'the proposal says where the pin and circle go');
  // The map fills the page under the header, and its layers stay under the side menu.
  const mapBox = await map.boundingBox();
  check(mapBox.width > 1100 && mapBox.height > 700, `the map fills the page (${Math.round(mapBox.width)}x${Math.round(mapBox.height)})`);
  check(await map.evaluate((node) => getComputedStyle(node.parentElement).isolation === 'isolate'), 'map layers stay under the side menu');
  for (const label of ['Show the office', 'Show my location', 'Full screen', 'Zoom in']) {
    check(await page.locator(`.leaflet-control a[title="${label}"]`).count() === 1, `map button: ${label}`);
  }
  check(await page.locator('.leaflet-control-layers').count() === 1 && await page.locator('.leaflet-control-scale').count() === 1, 'map types and scale');
  await shoot(page, 'desktop-location');

  // Search: a place by name, and typed coordinates.
  const searchBox = page.getByLabel('Search places');
  await searchBox.fill('Alisa Hotel');
  await searchBox.press('Enter');
  await page.getByRole('button', { name: /Alisa Hotel/ }).click();
  await page.waitForTimeout(1200);
  check(await page.locator('.leaflet-tooltip', { hasText: 'Alisa Hotel' }).count() === 1, 'a found place is marked on the map');
  await searchBox.fill('5.5658, -0.1773');
  await searchBox.press('Enter');
  await page.waitForTimeout(1200);
  check(await page.locator('.leaflet-tooltip', { hasText: '5.565800, -0.177300' }).count() === 1, 'typed coordinates are marked');
  await page.locator('.leaflet-control a[title="Show the office"]').click();
  await page.waitForTimeout(800);

  // Editing keeps the map (Leaflet's own classes stay on its container) and shows the 7 corners.
  await page.getByRole('button', { name: 'Draw area' }).click();
  await page.waitForTimeout(500);
  check(await map.evaluate((node) => node.classList.contains('leaflet-container') && Boolean(node.querySelector('.leaflet-tile-pane'))), 'the map stays while editing');
  const cornerButton = page.getByRole('button', { name: /^Corners \(/ });
  const cornerCount = async () => Number((await cornerButton.textContent()).match(/\d+/)[0]);
  check(await cornerCount() === 7, 'editing starts from the proposed corners');
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.45);
  await page.waitForTimeout(300);
  check(await cornerCount() === 8, 'a click adds a corner');
  await shoot(page, 'desktop-location-editing');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check(await cornerCount() === 7, 'Undo takes the corner back');
  await page.locator('.leaflet-marker-icon[title^="Corner 3"]').click();
  check(await cornerCount() === 6, 'clicking a corner removes it');
  await page.keyboard.press('Control+z');
  check(await cornerCount() === 7, 'Ctrl+Z undoes too');

  // One road point, or a spare room over 100 m, cannot be saved.
  await page.locator('.leaflet-marker-icon[title^="Road edge"]').first().click();
  check(await page.getByText('Add a second road edge point').count() === 1, 'one road point is explained');
  check(await page.getByRole('button', { name: 'Save area' }).isDisabled(), 'one road point cannot be saved');
  await page.keyboard.press('Control+z');
  const spare = page.getByLabel('Spare');
  await spare.fill('150');
  check(await page.getByText('Spare room must be 0 to 100 m.').count() === 1, 'spare over 100 m is explained');
  check(await page.getByRole('button', { name: 'Save area' }).isDisabled(), 'spare over 100 m cannot be saved');
  await spare.fill('25');

  // Cancel with changes asks first; Save sends the drawn area.
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.45);
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  check(asked === 'Discard your changes to the area?', 'Cancel asks before throwing away changes');
  check(await page.getByRole('button', { name: 'Save area' }).isVisible(), 'dismissing keeps editing');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Save area' }).click();
  await page.waitForTimeout(800);
  const sent = saved.find((body) => body.action === 'save');
  check(sent && sent.boundary.outline.length === 8 && sent.boundary.road && sent.boundary.roomMeters === 25, 'Save sends the area as drawn');
  await context.close();
}

async function desktopShots(browser) {
  const context = await browser.newContext(DESKTOP);
  await mockApi(context);
  const page = await context.newPage();
  for (const route of ['dashboard', 'entries', 'payments', 'exports', 'attendance/devices']) {
    await page.goto(`${baseUrl}/${route}`, { waitUntil: 'load' });
    // Let the page fetch its (mocked) data and finish its loading state.
    await page.waitForTimeout(4000);
    await shoot(page, `desktop-${route.replace('/', '-')}`);
  }
  await context.close();
}

const server = startServer();
let exitCode = 0;
try {
  await mkdir(outDir, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch();
  try {
    await phoneShots(browser);
    await locationShots(browser);
    await desktopShots(browser);
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}
process.exit(exitCode);
