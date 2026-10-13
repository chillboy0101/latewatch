/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function loadBackupLib() {
  require('tsx/cjs');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === 'server-only') return {};
    if (request === '@/db') return { db: {} };
    return originalLoad.call(this, request, ...args);
  };
  try {
    return require(path.join(root, 'src/lib/data-backup.ts'));
  } finally {
    Module._load = originalLoad;
  }
}

test('backups keep 12 weeks and use one dated file plus a manifest', () => {
  const { backupKeysForDate, isOlderThanRetention } = loadBackupLib();
  assert.deepEqual(backupKeysForDate('2026-10-18'), {
    backupKey: 'backups/latewatch-2026-10-18.json.gz',
    manifestKey: 'backups/latewatch-2026-10-18.manifest.json',
  });
  assert.equal(isOlderThanRetention('2026-07-26', '2026-10-18'), false); // exactly 12 weeks
  assert.equal(isOlderThanRetention('2026-07-25', '2026-10-18'), true);
});

test('backups cover the business tables and leave out logs and push secrets', () => {
  const { BACKUP_TABLE_NAMES } = loadBackupLib();
  for (const name of ['staff', 'attendance_record', 'lateness_entry', 'lateness_payment', 'lateness_payment_allocation', 'lateness_debt_pardon', 'attendance_permission', 'staff_leave_period', 'audit_event', 'work_calendar']) {
    assert.ok(BACKUP_TABLE_NAMES.includes(name), name);
  }
  for (const name of ['push_subscription', 'push_reminder_delivery', 'attendance_attempt', 'rate_limit', 'reminder_cron_run']) {
    assert.ok(!BACKUP_TABLE_NAMES.includes(name), name);
  }
});

test('the weekly backup runs from a guarded cron and the admin API is admin-only', () => {
  const cronRoute = read('src', 'app', 'api', 'backups', 'weekly', 'route.ts');
  const adminRoute = read('src', 'app', 'api', 'admin', 'backups', 'route.ts');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(cronRoute, /const guard = validateReminderCronAuth\(request\);\s*if \(!guard\.ok\) return guard\.response;/);
  assert.equal((adminRoute.match(/await enforceRole\(\['admin'\]\)/g) || []).length, 2);
  assert.match(read('src', 'proxy.ts'), /'\/api\/backups\/weekly',/);
  assert.ok(vercel.crons.some((cron) => cron.path === '/api/backups/weekly' && cron.schedule === '0 2 * * 0'));
  assert.match(read('src', 'app', 'exports', 'page.tsx'), /<BackupsCard \/>/);
});
