/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const exportsPagePath = path.join(__dirname, '../src/app/exports/page.tsx');
const queueRoutePath = path.join(__dirname, '../src/app/api/whatsapp/queue/route.ts');
const markSentRoutePath = path.join(__dirname, '../src/app/api/whatsapp/mark-sent/route.ts');
const staffRoutePath = path.join(__dirname, '../src/app/api/staff/route.ts');
const staffUpdateRoutePath = path.join(__dirname, '../src/app/api/staff/[id]/route.ts');

test('exports page exposes weekly WhatsApp notice queue controls', () => {
  const source = fs.readFileSync(exportsPagePath, 'utf8');

  assert.match(source, /Send Weekly WhatsApp/);
  assert.match(source, /type=weekly&weekStart=\$\{week\.exportStart\}&weekEnd=\$\{week\.exportEnd\}/);
  assert.match(source, /WhatsAppNoticeQueue/);
});

test('WhatsApp queue API supports daily and weekly queues', () => {
  const source = fs.readFileSync(queueRoutePath, 'utf8');

  assert.match(source, /createDailyWhatsAppQueue/);
  assert.match(source, /createWeeklyWhatsAppQueue/);
  assert.match(source, /type === 'daily'/);
  assert.match(source, /type === 'weekly'/);
  assert.match(source, /staff\.whatsappPhone/);
});

test('WhatsApp mark-sent API writes an audit event', () => {
  const source = fs.readFileSync(markSentRoutePath, 'utf8');

  assert.match(source, /writeAuditEvent/);
  assert.match(source, /entityType: 'whatsapp_notice'/);
  assert.match(source, /action: 'CREATE'/);
});

test('staff API returns and accepts WhatsApp notice settings', () => {
  const createSource = fs.readFileSync(staffRoutePath, 'utf8');
  const updateSource = fs.readFileSync(staffUpdateRoutePath, 'utf8');

  assert.match(createSource, /whatsappPhone: staff\.whatsappPhone/);
  assert.match(createSource, /whatsappNotificationsEnabled: staff\.whatsappNotificationsEnabled/);
  assert.match(createSource, /normalizeWhatsAppPhone/);
  assert.match(updateSource, /whatsappPhone\?: string \| null/);
  assert.match(updateSource, /whatsappNotificationsEnabled\?: boolean/);
  assert.match(updateSource, /Enter a valid WhatsApp number/);
});
