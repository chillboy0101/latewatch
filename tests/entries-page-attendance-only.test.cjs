/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const entriesPagePath = path.join(__dirname, '../src/app/entries/page.tsx');
const whatsappQueueComponentPath = path.join(__dirname, '../src/components/whatsapp/whatsapp-notice-queue.tsx');
const recalculateScriptPath = path.join(__dirname, '../scripts/recalculate-regular-staff-penalties.mjs');

test('entries page live penalty calculation preserves monitoring-only staff rules', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly\?: boolean \| null/);
  assert.match(source, /isAttendanceOnly: member\?\.isAttendanceOnly === true/);
});

test('entries page exposes an icon-only refresh button beside save entries', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /RefreshCw/);
  assert.match(source, /aria-label="Refresh lateness entries"/);
  assert.match(source, /onClick=\{\(\) => \{\s*setMessage\(null\);\s*void fetchStaffAndEntries\(\);\s*\}\}/);
  assert.match(source, /<RefreshCw className="h-4 w-4" \/>/);
});

test('entries page exposes daily WhatsApp notice queue controls', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const queueSource = fs.readFileSync(whatsappQueueComponentPath, 'utf8');

  assert.match(source, /Send WhatsApp Notices/);
  assert.match(source, /\/api\/whatsapp\/queue\?type=daily&date=\$\{selectedDateKey\}/);
  assert.match(source, /WhatsAppNoticeQueue/);
  assert.match(queueSource, /Open WhatsApp/);
  assert.match(queueSource, /Mark sent/);
});

test('regular staff recalculation apply notifies live pages to refetch entries', () => {
  const source = fs.readFileSync(recalculateScriptPath, 'utf8');

  assert.match(source, /async function publishInvalidation/);
  assert.match(source, /latewatch:\$\{channel\}/);
  assert.match(source, /'entries'/);
  assert.match(source, /'attendance'/);
  assert.match(source, /'dashboard'/);
});
