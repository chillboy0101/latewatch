/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { computePenalty } = require('../src/lib/penalty-calculator.ts');
const { getAuditFieldChanges, getAuditTargetName } = require('../src/lib/audit-display.ts');
const { getClientIp } = require('../src/lib/request-ip.ts');
const { isAfterWorkdayEnd } = require('../src/lib/work-hours.ts');

function requestWithHeaders(headers) {
  return {
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
  };
}

test('attendance rules use 8:30 AM as the lateness cutoff and close after 5:00 PM', () => {
  assert.deepEqual(
    computePenalty({ arrivalTime: '08:30', didNotSignOut: false, isHoliday: false }),
    { amount: 0, reason: '' },
  );
  assert.deepEqual(
    computePenalty({ arrivalTime: '08:31', didNotSignOut: false, isHoliday: false }),
    { amount: 10, reason: 'DIDN\'T COME BEFORE 8:30AM' },
  );
  assert.equal(isAfterWorkdayEnd('17:00:00'), false);
  assert.equal(isAfterWorkdayEnd('17:01:00'), true);
});

test('office network audit display includes the saved network IP', () => {
  const record = {
    afterJson: { allowedIp: '192.0.2.15', name: 'Office WiFi' },
    beforeJson: { allowedIp: '192.0.2.10', name: 'Office WiFi' },
    entityId: 'network-1',
    entityType: 'office_network',
  };

  assert.equal(getAuditTargetName(record), 'Office WiFi (192.0.2.15)');

  const changes = getAuditFieldChanges(record);
  assert.deepEqual(changes, [{
    after: '192.0.2.15',
    before: '192.0.2.10',
    field: 'allowedIp',
    label: 'Office IP',
  }]);
});

test('client IP detection prefers Vercel forwarded IP and normalizes IPv6 wrappers', () => {
  assert.equal(
    getClientIp(requestWithHeaders({
      'x-forwarded-for': '198.51.100.20, 10.0.0.1',
      'x-vercel-forwarded-for': '203.0.113.10, 10.0.0.1',
    })),
    '203.0.113.10',
  );
  assert.equal(getClientIp(requestWithHeaders({ 'x-vercel-forwarded-for': '[2001:db8::1]' })), '2001:db8::1');
});
