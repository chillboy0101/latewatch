#!/usr/bin/env node
// Local UI harness: screenshots signed-in pages at phone and desktop sizes without Clerk or the
// database. It starts `next dev` with LATEWATCH_UI_HARNESS=1 (next.config.ts then swaps Clerk's
// client package for tests/ui/clerk-mock.tsx) and answers every /api call with made-up data
// from tests/ui/fixtures.mjs. Screenshots land in output/ui-shots/.
//
//   npm run ui:shots

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
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
  // Next's dev-only error badge would cover the page corner; production has none.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
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

// Esri's map works here without the internet: its own files (components, styles, icons,
// translations) come from the same packages in node_modules instead of js.arcgis.com, its raster
// basemaps get plain tiles, and anything else Esri is unavailable, as when offline.
const ESRI_FILES = [
  [/^https:\/\/js\.arcgis\.com\/[^/]+\/@arcgis\/core\/assets\//, 'node_modules/@arcgis/core/assets/'],
  [/^https:\/\/js\.arcgis\.com\/[^/]+\/map-components\//, 'node_modules/@arcgis/map-components/dist/cdn/'],
  [/^https:\/\/js\.arcgis\.com\/calcite-components\/[^/]+\//, 'node_modules/@esri/calcite-components/dist/cdn/'],
];
const ESRI_HOSTS = /^https:\/\/([a-z0-9-]+\.)*arcgis(online)?\.com\//;

// A plain 256 px PNG tile with a faint edge, so moving the map shows.
function plainTile() {
  const size = 256;
  const rows = Array.from({ length: size }, (_, y) => {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) row.set(x === 0 || y === 0 ? [70, 92, 76] : [46, 64, 52], 1 + x * 3);
    return row;
  });
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// A tiled map service in Web Mercator, as Esri's raster basemaps describe themselves.
function tiledService() {
  const webMercator = { latestWkid: 3857, wkid: 102100 };
  const world = { spatialReference: webMercator, xmax: 20037508.342787, xmin: -20037508.342787, ymax: 20037508.342787, ymin: -20037508.342787 };
  const lods = Array.from({ length: 24 }, (_, level) => ({ level, resolution: 156543.03392800014 / 2 ** level, scale: 591657527.591555 / 2 ** level }));
  return {
    capabilities: 'Map', copyrightText: 'UI harness tiles', currentVersion: 11.3, fullExtent: world, initialExtent: world,
    maxScale: lods[23].scale, minScale: 0, singleFusedMapCache: true, spatialReference: webMercator,
    tileInfo: { cols: 256, dpi: 96, format: 'PNG', lods, origin: { x: world.xmin, y: world.ymax }, rows: 256, spatialReference: webMercator },
  };
}

async function serveEsriOffline(context, geocoder) {
  const tile = plainTile();
  const service = JSON.stringify(tiledService());
  await context.route(ESRI_HOSTS, (route) => {
    const url = new URL(route.request().url());
    const href = `${url.origin}${url.pathname}`;
    for (const [prefix, dir] of ESRI_FILES) {
      if (!prefix.test(href)) continue;
      const file = path.join(root, dir, href.replace(prefix, ''));
      return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ body: 'Not found', status: 404 });
    }
    if (/\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(url.pathname)) return route.fulfill({ body: tile, contentType: 'image/png' });
    if (/\/MapServer$/.test(url.pathname)) return route.fulfill({ body: service, contentType: 'application/json' });
    if (url.host === 'geocode.arcgis.com') return geocoder(route, url);
    return route.fulfill({ body: JSON.stringify({ error: { code: 404, message: 'Not available in the UI harness' } }), contentType: 'application/json', status: 404 });
  });
}

// Office Location on a desktop: Esri's map and tools, a proposed area, then editing it.
async function locationShots(browser) {
  const check = (condition, message) => {
    if (!condition) throw new Error(`Office Location check failed: ${message}`);
  };
  const context = await browser.newContext(DESKTOP);
  await mockApi(context);
  // Esri's place search answers with one made-up hotel.
  const geocoded = [];
  await serveEsriOffline(context, (route, url) => {
    const action = url.pathname.split('/').pop();
    geocoded.push(action);
    const body = action === 'suggest'
      ? { suggestions: [{ isCollection: false, magicKey: 'alisa-1', text: 'Alisa Hotel, North Ridge, Accra, GHA' }] }
      : action === 'findAddressCandidates'
        ? {
          candidates: [{ address: 'Alisa Hotel, North Ridge, Accra, GHA', attributes: { Addr_type: 'POI' }, extent: { xmax: -0.198, xmin: -0.2, ymax: 5.5672, ymin: 5.5652 }, location: { x: -0.199, y: 5.5662 }, score: 100 }],
          spatialReference: { latestWkid: 4326, wkid: 4326 },
        }
        : { capabilities: 'Geocode,ReverseGeocode,Suggest', currentVersion: 11.3, singleLineAddressField: { name: 'SingleLine', type: 'esriFieldTypeString' }, spatialReference: { latestWkid: 4326, wkid: 4326 } };
    return route.fulfill({ body: JSON.stringify(body), contentType: 'application/json' });
  });
  const page = await context.newPage();
  const saved = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/attendance/location/boundary')) saved.push(request.postDataJSON());
  });
  await page.goto(`${baseUrl}/location`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('arcgis-map')?.ready === true, null, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const map = page.locator('arcgis-map');
  const centre = () => map.evaluate((node) => [node.center.longitude, node.center.latitude]);
  check(await page.getByText(/The pin moves to its centre, with a \d+ m backup circle round every edge\./).count() === 1, 'the proposal says where the pin and circle go');
  // The map fills the page under the header, and its layers stay under the side menu.
  const box = await map.boundingBox();
  check(box.width > 1100 && box.height > 700, `the map fills the page (${Math.round(box.width)}x${Math.round(box.height)})`);
  check(await map.evaluate((node) => getComputedStyle(node.parentElement).isolation === 'isolate'), 'map layers stay under the side menu');
  for (const tool of ['arcgis-search', 'arcgis-zoom', 'arcgis-home', 'arcgis-locate', 'arcgis-fullscreen', 'arcgis-basemap-gallery', 'arcgis-scale-bar']) {
    check(await page.locator(tool).count() === 1, `Esri tool on the map: ${tool}`);
  }
  await shoot(page, 'desktop-location');
  const office = await centre();

  // Esri's search: a suggestion while typing; picking it takes the map there.
  const searchBox = page.getByPlaceholder('Search places or addresses');
  await searchBox.click();
  await searchBox.pressSequentially('Alisa', { delay: 40 });
  const suggestion = page.locator('calcite-autocomplete-item', { hasText: 'Alisa Hotel' });
  await suggestion.waitFor({ timeout: 10_000 });
  await suggestion.click();
  await page.waitForTimeout(2000);
  const found = await centre();
  check(Math.abs(found[0] + 0.199) < 0.0005 && Math.abs(found[1] - 5.5662) < 0.0005, `search takes the map to the place (${found})`);
  check(geocoded.includes('suggest') && geocoded.includes('findAddressCandidates'), `Esri answers the search (${geocoded.join(', ')})`);
  await shoot(page, 'desktop-location-search');

  // Home goes back to the office.
  await page.locator('arcgis-home').click();
  await page.waitForTimeout(1500);
  const home = await centre();
  check(Math.abs(home[0] - office[0]) < 0.0002 && Math.abs(home[1] - office[1]) < 0.0002, `Home goes back to the office (${home})`);

  // Outside editing a click shows where it is, in Esri's popup.
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.7);
  await page.getByText('This spot', { exact: true }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Esri's basemaps: the gallery lists them and a click switches the map.
  await page.locator('arcgis-expand').click();
  await page.waitForTimeout(1500);
  const basemaps = await page.locator('arcgis-basemap-gallery-item').evaluateAll((items) => items.map((item) => item.item?.basemap?.title || ''));
  check(basemaps.length === 10 && basemaps.includes('Imagery with Labels') && basemaps.includes('Imagery'), `the gallery lists Esri's basemaps (${basemaps.join(', ')})`);
  await shoot(page, 'desktop-location-basemaps');
  await page.locator('arcgis-basemap-gallery-item').nth(basemaps.indexOf('Imagery')).click();
  await page.waitForTimeout(1500);
  check(await map.evaluate((node) => node.basemap?.title) === 'Imagery', 'a basemap click switches the map');
  await page.keyboard.press('Escape');

  // Editing: the 7 proposed corners show as numbered markers; click adds, click a corner removes,
  // drag moves one while the map stays still.
  const draft = buildFixtures()['/api/attendance/location/boundary'].draft;
  // Where a point is on screen, in pixels from the map's top-left (Web Mercator; the map is not rotated).
  const screenOf = (point) => map.evaluate((node, { latitude, longitude }) => {
    const radius = 6378137;
    const x = radius * longitude * Math.PI / 180;
    const y = radius * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
    return { x: (x - node.view.extent.xmin) / node.view.resolution, y: (node.view.extent.ymax - y) / node.view.resolution };
  }, point);
  // How much of the 24 px around a point is the corner markers' blue.
  const markerBlue = (at) => map.evaluate(async (node, spot) => {
    const shot = await node.view.takeScreenshot({ area: { height: 24, width: 24, x: spot.x - 12, y: spot.y - 12 } });
    const pixels = shot.data.data;
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 2] > 180 && pixels[index] < 90 && pixels[index + 1] < 140) blue += 1;
    }
    return blue / (pixels.length / 4);
  }, at);
  await page.getByRole('button', { name: 'Draw area' }).click();
  await page.waitForTimeout(1000);
  const cornerButton = page.getByRole('button', { name: /^Corners \(/ });
  const cornerCount = async () => Number((await cornerButton.textContent()).match(/\d+/)[0]);
  check(await cornerCount() === 7, 'editing starts from the proposed corners');
  const corner3 = await screenOf(draft.outline[2]);
  check(await markerBlue(corner3) > 0.15, 'the corners show as markers on the map');
  await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.45);
  await page.waitForTimeout(400);
  check(await cornerCount() === 8, 'a click adds a corner');
  await shoot(page, 'desktop-location-editing');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check(await cornerCount() === 7, 'Undo takes the corner back');
  await page.mouse.click(box.x + corner3.x, box.y + corner3.y);
  await page.waitForTimeout(400);
  check(await cornerCount() === 6, 'clicking a corner removes it');
  await page.keyboard.press('Control+z');
  check(await cornerCount() === 7, 'Ctrl+Z undoes too');
  const before = await centre();
  const corner1 = await screenOf(draft.outline[0]);
  await page.mouse.move(box.x + corner1.x, box.y + corner1.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + corner1.x + 6 * step, box.y + corner1.y + 3 * step);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await centre();
  check(await cornerCount() === 7 && after[0] === before[0] && after[1] === before[1], 'dragging a corner moves it, not the map');

  // One road point, or a spare room over 100 m, cannot be saved.
  const road = await screenOf(draft.road.from);
  await page.mouse.click(box.x + road.x, box.y + road.y);
  await page.waitForTimeout(400);
  check(await page.getByText('Add a second road edge point').count() === 1, 'one road point is explained');
  check(await page.getByRole('button', { name: 'Save area' }).isDisabled(), 'one road point cannot be saved');
  await page.keyboard.press('Control+z');
  const spare = page.getByLabel('Spare');
  await spare.fill('150');
  check(await page.getByText('Spare room must be 0 to 100 m.').count() === 1, 'spare over 100 m is explained');
  check(await page.getByRole('button', { name: 'Save area' }).isDisabled(), 'spare over 100 m cannot be saved');
  await spare.fill('25');

  // Cancel with changes asks first; Save sends the area as drawn.
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
  const metres = (a, b) => Math.hypot((a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180), (a.latitude - b.latitude) * 110_574);
  check(sent && sent.boundary.outline.length === 7 && sent.boundary.road && sent.boundary.roomMeters === 25, 'Save sends the area as drawn');
  check(metres(sent.boundary.outline[0], draft.outline[0]) > 5, 'the dragged corner is saved where it was dropped');
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
    // UI_SHOTS_ONLY=location,desktop runs just those groups.
    const only = process.env.UI_SHOTS_ONLY?.split(',');
    const groups = { phone: phoneShots, location: locationShots, desktop: desktopShots };
    for (const [name, run] of Object.entries(groups)) {
      if (!only || only.includes(name)) await run(browser);
    }
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
