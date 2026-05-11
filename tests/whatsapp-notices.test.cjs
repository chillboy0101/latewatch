/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  buildWhatsAppHref,
  createDailyWhatsAppQueue,
  createWeeklyWhatsAppQueue,
  normalizeWhatsAppPhone,
} = require('../src/lib/whatsapp-notices.ts');

test('normalizes WhatsApp phone numbers to E.164 with Ghana defaults', () => {
  assert.equal(normalizeWhatsAppPhone('0241234567'), '+233241234567');
  assert.equal(normalizeWhatsAppPhone('233241234567'), '+233241234567');
  assert.equal(normalizeWhatsAppPhone('+233241234567'), '+233241234567');
  assert.equal(normalizeWhatsAppPhone('not a phone'), null);
});

test('builds wa.me links with encoded message text', () => {
  const href = buildWhatsAppHref(
    '+233241234567',
    'Hello Jane Staff, LateWatch notice: your lateness penalty for 2026-05-08 is GHC 15.00.',
  );

  assert.equal(
    href,
    'https://wa.me/233241234567?text=Hello%20Jane%20Staff%2C%20LateWatch%20notice%3A%20your%20lateness%20penalty%20for%202026-05-08%20is%20GHC%2015.00.',
  );
});

test('daily WhatsApp queue includes only owing staff with enabled valid numbers', () => {
  const queue = createDailyWhatsAppQueue({
    date: '2026-05-08',
    rows: [
      { staffId: 'staff-1', staffName: 'Jane Staff', whatsappPhone: '0241234567', whatsappNotificationsEnabled: true, computedAmount: '15.00' },
      { staffId: 'staff-2', staffName: 'Zero Staff', whatsappPhone: '0240000000', whatsappNotificationsEnabled: true, computedAmount: '0.00' },
      { staffId: 'staff-3', staffName: 'Missing Phone', whatsappPhone: null, whatsappNotificationsEnabled: true, computedAmount: '12.00' },
      { staffId: 'staff-4', staffName: 'Disabled Staff', whatsappPhone: '0249999999', whatsappNotificationsEnabled: false, computedAmount: '20.00' },
    ],
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].staffId, 'staff-1');
  assert.equal(queue[0].phone, '+233241234567');
  assert.equal(
    queue[0].message,
    'Hello Jane Staff, LateWatch notice: your lateness penalty for 2026-05-08 is GHC 15.00. Please contact Admin if this is incorrect.',
  );
  assert.match(queue[0].href, /^https:\/\/wa\.me\/233241234567\?text=/);
});

test('weekly WhatsApp queue sums penalties per owing staff member', () => {
  const queue = createWeeklyWhatsAppQueue({
    weekStart: '2026-05-04',
    weekEnd: '2026-05-08',
    rows: [
      { staffId: 'staff-1', staffName: 'Jane Staff', whatsappPhone: '+233241234567', whatsappNotificationsEnabled: true, computedAmount: '15.00' },
      { staffId: 'staff-1', staffName: 'Jane Staff', whatsappPhone: '+233241234567', whatsappNotificationsEnabled: true, computedAmount: '20.00' },
      { staffId: 'staff-2', staffName: 'Zero Staff', whatsappPhone: '+233241234568', whatsappNotificationsEnabled: true, computedAmount: '0.00' },
    ],
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].staffId, 'staff-1');
  assert.equal(queue[0].amount, '35.00');
  assert.equal(
    queue[0].message,
    'Hello Jane Staff, LateWatch weekly notice: your total lateness penalty for 2026-05-04 to 2026-05-08 is GHC 35.00. Please contact Admin if this is incorrect.',
  );
});
