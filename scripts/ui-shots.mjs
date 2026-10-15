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
  const context = await browser.newContext(DESKTOP);
  await mockApi(context);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/location`, { waitUntil: 'load' });
  // Satellite tiles may not load in the harness; the lines and corners still show.
  const map = page.getByRole('application', { name: 'Satellite map of the office grounds' });
  await map.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shoot(page, 'desktop-location');
  await page.getByRole('button', { name: 'Draw area' }).click();
  await page.waitForTimeout(500);
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.45);
  await page.waitForTimeout(300);
  await shoot(page, 'desktop-location-editing');
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
