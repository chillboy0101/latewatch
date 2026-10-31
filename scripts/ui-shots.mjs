#!/usr/bin/env node
// Local UI harness: screenshots signed-in pages at phone and desktop sizes without Clerk or the
// database. It starts `next dev` with LATEWATCH_UI_HARNESS=1 (next.config.ts then swaps Clerk's
// client package for tests/ui/clerk-mock.tsx) and answers every /api call with made-up data
// from tests/ui/fixtures.mjs. Screenshots land in output/ui-shots/.
//
//   npm run ui:shots

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
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

async function mockApi(context, adjust) {
  const fixtures = buildFixtures();
  adjust?.(fixtures);
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

// Esri's map works here without the internet. The page loads the SDK from Esri's servers
// (https://js.arcgis.com/5.1/); here that script is a stand-in that loads Esri's published Calcite and
// map components from node_modules and answers $arcgis.import from a local build of @arcgis/core.
// Esri's other files (styles, icons, translations) come from the same packages, its raster basemaps
// get plain tiles, and anything else Esri is unavailable, as when offline.
const ESRI_SDK = /^https:\/\/js\.arcgis\.com\/5\.1\/$/;
const ESRI_CORE_BUILD = /^https:\/\/js\.arcgis\.com\/__ui-harness-core\//;
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

const packageVersion = async (name) => JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

// @arcgis/core built once (cached under node_modules/.cache) as one module per public file, which the
// stand-in's $arcgis.import loads by name, as Esri's servers do.
async function buildEsriCore() {
  const outdir = path.join(root, 'node_modules', '.cache', `ui-harness-arcgis-core-${await packageVersion('@arcgis/core')}`);
  if (existsSync(path.join(outdir, 'registry.js'))) return outdir;
  const coreDir = path.join(root, 'node_modules', '@arcgis', 'core');
  const modules = (await readdir(coreDir, { recursive: true }))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.js') && !/^(assets|chunks)\//.test(file));
  const entry = path.join(root, 'node_modules', '.cache', 'ui-harness-arcgis-core-entry.js');
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, `export const modules = {\n${modules.map((file) => `  ${JSON.stringify(file.replace(/\.js$/, ''))}: () => import(${JSON.stringify(`@arcgis/core/${file}`)}),`).join('\n')}\n};\n`);
  await build({
    absWorkingDir: root,
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    entryNames: 'registry',
    entryPoints: [entry],
    format: 'esm',
    logLevel: 'error',
    outdir,
    splitting: true,
    target: 'es2022',
  });
  return outdir;
}

async function esriSdkStandIn() {
  const [calcite, components] = await Promise.all([packageVersion('@esri/calcite-components'), packageVersion('@arcgis/map-components')]);
  return `import { modules } from 'https://js.arcgis.com/__ui-harness-core/registry.js';
const load = async (name) => {
  const key = name.replace(/^@arcgis\\/core\\//, '').replace(/\\.js$/, '');
  if (!modules[key]) throw new Error('No such @arcgis/core module: ' + name);
  const module = await modules[key]();
  return module.default ?? module;
};
if (!globalThis.$arcgis) Object.defineProperty(globalThis, '$arcgis', { enumerable: true, value: {} });
globalThis.$arcgis.import = (names) => (Array.isArray(names) ? Promise.all(names.map(load)) : load(names));
for (const href of ['https://js.arcgis.com/calcite-components/${calcite}/main.css', 'https://js.arcgis.com/${components}/map-components/main.css']) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}
await import('https://js.arcgis.com/calcite-components/${calcite}/index.js');
await import('https://js.arcgis.com/${components}/map-components/index.js');
`;
}

async function serveEsriOffline(context, geocoder) {
  const tile = plainTile();
  const service = JSON.stringify(tiledService());
  const coreDir = await buildEsriCore();
  const standIn = await esriSdkStandIn();
  await context.route(ESRI_HOSTS, (route) => {
    const url = new URL(route.request().url());
    const href = `${url.origin}${url.pathname}`;
    if (ESRI_SDK.test(href)) return route.fulfill({ body: standIn, contentType: 'text/javascript' });
    if (ESRI_CORE_BUILD.test(href)) {
      const file = path.join(coreDir, href.replace(ESRI_CORE_BUILD, ''));
      return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ body: 'Not found', status: 404 });
    }
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
// The staff check-in with an office location set, so the location sheet and live location show.
function withOfficeLocation(fixtures) {
  const office = fixtures['/api/attendance/location'].location;
  fixtures['/api/attendance/check-in'] = {
    ...fixtures['/api/attendance/check-in'],
    locationConfigured: true,
    locationPolicy: {
      id: office.id,
      latitude: office.latitude,
      longitude: office.longitude,
      maxAccuracyMeters: office.maxAccuracyMeters,
      name: office.name,
      radiusMeters: office.radiusMeters,
    },
  };
}

async function locationSheetShots(browser) {
  // Location not allowed yet: the sheet says why before the browser asks.
  let context = await browser.newContext(PHONE);
  await mockApi(context, withOfficeLocation);
  let page = await context.newPage();
  await page.goto(`${baseUrl}/check-in`, { waitUntil: 'load' });
  await page.getByRole('dialog', { name: 'Turn on location' }).waitFor({ timeout: 60_000 });
  await shoot(page, 'phone-location-ask');
  // Headless Chromium turns down the browser's own popup, so Allow leads to the "off" sheet.
  await page.getByRole('button', { name: 'Allow location' }).click();
  await page.getByRole('dialog', { name: 'Location is off' }).waitFor({ timeout: 30_000 });
  await shoot(page, 'phone-location-off');
  await context.close();

  // Location already allowed, at the office: no sheet, straight to check-in.
  context = await browser.newContext({
    ...PHONE,
    geolocation: { accuracy: 10, latitude: 5.5658293, longitude: -0.1775282 },
    permissions: ['geolocation'],
  });
  await mockApi(context, withOfficeLocation);
  page = await context.newPage();
  await page.goto(`${baseUrl}/check-in`, { waitUntil: 'load' });
  await page.getByText('At office').waitFor({ timeout: 60_000 });
  const reminders = page.getByRole('dialog', { name: /reminders/i });
  if (await reminders.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Not now' }).click();
  await shoot(page, 'phone-location-allowed');
  await context.close();
}

// An iPhone browser (not the home-screen app) checks in: once the "checked in" message goes, the
// "Add to Home Screen" banner drops down.
async function installNudgeShots(browser) {
  const context = await browser.newContext({
    ...PHONE,
    geolocation: { accuracy: 10, latitude: 5.5658293, longitude: -0.1775282 },
    permissions: ['geolocation'],
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  let checkedIn = null;
  await mockApi(context, (fixtures) => {
    withOfficeLocation(fixtures);
    checkedIn = fixtures['/api/attendance/check-in'];
    fixtures['/api/attendance/check-in'] = { ...checkedIn, attendance: null };
    fixtures['/api/attendance/check-in/receipt-notifications'] = { notifications: [], receipts: [] };
  });
  // Registered after mockApi, so it answers the check-in itself with the checked-in status.
  await context.route('**/api/attendance/check-in', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ body: JSON.stringify(checkedIn), contentType: 'application/json', status: 200 })
    : route.fallback()));
  const page = await context.newPage();
  await page.goto(`${baseUrl}/check-in`, { waitUntil: 'load' });
  await page.getByText('At office').waitFor({ timeout: 60_000 });
  const reminders = page.getByRole('dialog', { name: /reminders/i });
  if (await reminders.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Check In', exact: true }).click();
  await page.getByText('Add to Home Screen').waitFor({ timeout: 15_000 });
  await shoot(page, 'phone-install-nudge');
  await context.close();
}

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

// Payments on a desktop: the staff table shows everyone's total, or one month (picked under Offence
// book inputs); paying from a month pays that month, paying from Total pays as before.
async function paymentsShots(browser) {
  const check = (condition, message) => {
    if (!condition) throw new Error(`Payments check failed: ${message}`);
  };
  const now = new Date();
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(lastMonthDate);
  const lastMonthName = lastMonthDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const day = (id, date, penalty, paid) => ({
    arrivalTime: '08:45:00',
    date,
    entryId: id,
    outstandingAmount: (penalty - paid).toFixed(2),
    pardonedAmount: '0.00',
    paidAmount: paid.toFixed(2),
    penaltyAmount: penalty.toFixed(2),
    reason: 'Late arrival',
    status: paid >= penalty ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid',
  });
  const payment = (id, amount, month, recordedAt) => ({ amount, id, months: [month], note: null, recordedAt, recordedByEmail: 'admin@latewatch.test' });
  const person = (id, fullName, entries, payments) => {
    const sum = (key) => entries.reduce((total, entry) => total + Number(entry[key]), 0).toFixed(2);
    return {
      email: `${id}@latewatch.test`, entries, fullName, id, isAttendanceOnly: false, isNssPersonnel: false,
      outstandingBalance: sum('outstandingAmount'), paidAmount: sum('paidAmount'), payments, totalPenalty: sum('penaltyAmount'),
    };
  };
  // Ama owes for both months; Kofi paid last month and owes this month; Esi was never charged.
  const data = {
    monthlyBreakdown: [
      { month: lastMonth, paidAmount: '7.00', pardonedAmount: '0.00', penaltyAmount: '16.00', unpaidAmount: '9.00' },
      { month: thisMonth, paidAmount: '5.00', pardonedAmount: '0.00', penaltyAmount: '17.00', unpaidAmount: '12.00' },
    ],
    scope: 'all',
    staff: [
      person('ama', 'Ama Owusu', [day('a1', `${lastMonth}-08`, 9, 0), day('a2', `${thisMonth}-02`, 5, 3)], [
        payment('pay-a2', '3.00', thisMonth, `${thisMonth}-03T09:00:00.000Z`),
      ]),
      person('kofi', 'Kofi Boateng', [day('k1', `${lastMonth}-12`, 7, 7), day('k2', `${thisMonth}-06`, 12, 2)], [
        payment('pay-k2', '2.00', thisMonth, `${thisMonth}-07T09:00:00.000Z`),
        payment('pay-k1', '7.00', lastMonth, `${thisMonth}-01T09:00:00.000Z`),
      ]),
      person('esi', 'Esi Mensah', [], []),
    ],
  };
  const context = await browser.newContext(DESKTOP);
  await mockApi(context);
  const paid = [];
  await context.route('**/api/payments/lateness', (route) => {
    if (route.request().method() === 'POST') {
      paid.push(route.request().postDataJSON());
      return route.fulfill({ body: JSON.stringify({ success: true }), contentType: 'application/json' });
    }
    return route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/payments`, { waitUntil: 'load' });
  const row = (name) => page.locator('tbody tr', { hasText: name });
  await row('Ama Owusu').waitFor({ timeout: 60_000 });
  const cells = async (name) => (await row(name).locator('td').allTextContents()).map((text) => text.trim());
  // The whole totals row (the Penalties chip's row).
  const toolbar = () => page.locator('span', { hasText: /^Penalties$/ }).first().locator('xpath=../..').textContent();
  const totalButton = page.getByRole('button', { name: 'Total', exact: true });
  const monthButton = totalButton.locator('xpath=following-sibling::button[1]');
  const columns = () => page.locator('thead th').count();

  // Total first: what each person owes across all months.
  check(await totalButton.getAttribute('aria-pressed') === 'true' && await columns() === 4, 'the table opens on everyone\'s total');
  check((await cells('Ama Owusu')).slice(1, 3).join('|') === 'Unpaid|GHC 11.00', `Ama in total: ${await cells('Ama Owusu')}`);
  check((await cells('Kofi Boateng')).slice(1, 3).join('|') === 'Unpaid|GHC 10.00', `Kofi in total: ${await cells('Kofi Boateng')}`);
  const totalsText = await toolbar();
  check(totalsText.includes('GHC 33.00') && totalsText.includes('GHC 21.00') && !totalsText.includes('Live outstanding'), `the totals row is every month in Total (${totalsText})`);
  await shoot(page, 'desktop-payments-total');

  // This month: Kofi owes GHC 10, Ama GHC 2, Esi nothing.
  await monthButton.click();
  check(await columns() === 4, 'the month view keeps the same columns');
  check((await cells('Kofi Boateng')).slice(1, 3).join('|') === 'Unpaid|GHC 10.00', `Kofi this month: ${await cells('Kofi Boateng')}`);
  check((await cells('Ama Owusu')).slice(1, 3).join('|') === 'Unpaid|GHC 2.00', `Ama this month: ${await cells('Ama Owusu')}`);
  check((await cells('Esi Mensah')).slice(1, 3).join('|') === 'Nothing owed|GHC 0.00', `Esi this month: ${await cells('Esi Mensah')}`);
  check((await toolbar()).includes('GHC 17.00'), 'the month totals are this month');

  // Last month: Ama owes GHC 9, Kofi paid his GHC 7.
  const yearSelect = page.locator('select', { has: page.locator('option[value="2030"]') });
  const monthSelect = page.locator('select', { has: page.locator('option', { hasText: 'January' }) });
  await yearSelect.selectOption(String(lastMonthDate.getFullYear()));
  await monthSelect.selectOption(String(lastMonthDate.getMonth()));
  await page.waitForTimeout(500);
  check((await cells('Ama Owusu')).slice(1, 3).join('|') === 'Unpaid|GHC 9.00', `Ama last month: ${await cells('Ama Owusu')}`);
  check((await cells('Kofi Boateng')).slice(1, 3).join('|') === 'Nothing owed|GHC 0.00', `Kofi last month: ${await cells('Kofi Boateng')}`);
  check((await toolbar()).includes('GHC 16.00'), 'the month totals follow the month');
  await page.getByRole('button', { name: 'Unpaid', exact: true }).click();
  check(await row('Ama Owusu').count() === 1 && await row('Kofi Boateng').count() === 0, 'Unpaid lists who owes for that month');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await shoot(page, 'desktop-payments-last-month');

  // From Total, picking a month up top shows that month.
  await totalButton.click();
  check((await cells('Ama Owusu')).slice(1, 3).join('|') === 'Unpaid|GHC 11.00', 'Total goes back to everyone\'s total');
  check((await toolbar()).includes('GHC 33.00'), 'the totals row goes back to every month');
  await yearSelect.selectOption(String(now.getFullYear()));
  await monthSelect.selectOption(String(now.getMonth()));
  await page.waitForTimeout(500);
  check(await monthButton.getAttribute('aria-pressed') === 'true', 'picking a month switches the table to it');
  check((await cells('Kofi Boateng')).slice(1, 3).join('|') === 'Unpaid|GHC 10.00', `Kofi after picking this month: ${await cells('Kofi Boateng')}`);
  await yearSelect.selectOption(String(lastMonthDate.getFullYear()));
  await monthSelect.selectOption(String(lastMonthDate.getMonth()));
  await page.waitForTimeout(500);

  // Ama's dialog shows last month's day, what she owes in all, and pays within the month.
  await row('Ama Owusu').getByRole('button', { name: 'Manage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  check((await dialog.textContent()).includes(`Main Staff · ${lastMonthName} · GHC 11.00 owed in total`), 'the dialog names the month and the total owed');
  check(await dialog.getByRole('button', { name: 'Mark as paid' }).count() === 1, 'only that month\'s day is listed');
  check(await dialog.getByText('Payments', { exact: true }).count() === 0, 'no payments paid that month');
  await dialog.getByLabel('Payment amount').fill('20');
  check(await dialog.getByText(`More than the ${lastMonthName} balance (GHC 9.00).`).count() === 1, 'too much for the month is explained');
  check(await dialog.getByRole('button', { name: 'Record amount' }).isDisabled(), 'too much for the month cannot be recorded');
  await dialog.getByLabel('Payment amount').fill('');
  await shoot(page, 'desktop-payments-month-dialog');
  await dialog.getByRole('button', { name: 'Pay full balance' }).click();
  await page.waitForTimeout(800);
  const sent = paid[0];
  check(sent && sent.amount === 9 && sent.month === lastMonth && sent.staffId === 'ama', `Pay full balance pays the month (${JSON.stringify(sent)})`);
  await page.keyboard.press('Escape');

  // From Total, Pay full balance pays everything owed, as before.
  await totalButton.click();
  await row('Ama Owusu').getByRole('button', { name: 'Manage' }).click();
  await dialog.waitFor();
  check((await dialog.textContent()).includes('Main Staff') && !(await dialog.textContent()).includes('owed in total'), 'the Total dialog shows the total, not a month');
  check(await dialog.getByRole('button', { name: 'Mark as paid' }).count() === 2, 'the Total dialog lists every month\'s days');
  await dialog.getByRole('button', { name: 'Pay full balance' }).click();
  await page.waitForTimeout(800);
  const sentTotal = paid[1];
  check(sentTotal && sentTotal.amount === 11 && sentTotal.month === undefined && sentTotal.staffId === 'ama', `Pay full balance in Total pays everything (${JSON.stringify(sentTotal)})`);
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
    // UI_SHOTS_ONLY=location,payments runs just those groups.
    const only = process.env.UI_SHOTS_ONLY?.split(',');
    const groups = { phone: phoneShots, locationSheet: locationSheetShots, installNudge: installNudgeShots, location: locationShots, payments: paymentsShots, desktop: desktopShots };
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
