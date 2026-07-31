/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const deviceBindingPath = path.join(root, 'src/lib/device-binding.ts');
const deviceRekeyPath = path.join(root, 'src/lib/device-rekey.ts');
const checkInRoutePath = path.join(root, 'src/app/api/attendance/check-in/route.ts');
const pushSubscriptionRoutePath = path.join(root, 'src/app/api/attendance/check-in/push-subscription/route.ts');

test('device binding keeps a legacy hash so rotating the secret does not unbind anyone', () => {
  const source = fs.readFileSync(deviceBindingPath, 'utf8');

  assert.match(source, /process\.env\.DEVICE_BINDING_SECRET/);
  assert.match(source, /function legacyDeviceSecret/);
  assert.match(source, /function primaryDeviceSecret/);
  assert.match(source, /export function legacyHashDeviceToken/);
  // Returning null when nothing has rotated is what makes the re-key path a no-op until
  // DEVICE_BINDING_SECRET is actually set.
  assert.match(source, /if \(legacy === primaryDeviceSecret\(\)\) return null;/);
});

test('resolveDeviceHash migrates both tables that store a device hash', () => {
  const source = fs.readFileSync(deviceRekeyPath, 'utf8');

  assert.match(source, /export async function resolveDeviceHash/);
  assert.match(source, /staffDevice/);
  assert.match(source, /deviceTransferRequest/);
  assert.match(source, /if \(!legacyHash \|\| legacyHash === deviceHash\) return deviceHash;/);
  // A failed migration must never block attendance.
  assert.match(source, /catch \(error\)/);
  // The deployment-order constraint is load-bearing: setting the env var on a build without
  // this fallback invalidates every trusted device at once.
  assert.match(source, /DEPLOYMENT ORDER/);
});

test('the routes that bind a device go through the re-key path', () => {
  const checkIn = fs.readFileSync(checkInRoutePath, 'utf8');
  const pushSubscription = fs.readFileSync(pushSubscriptionRoutePath, 'utf8');

  assert.match(checkIn, /resolveDeviceHash/);
  assert.match(pushSubscription, /resolveDeviceHash/);
  // Hashing directly would skip the migration and untrust the device.
  assert.doesNotMatch(checkIn, /hashDeviceToken\(/);
  assert.doesNotMatch(pushSubscription, /hashDeviceToken\(/);
});

test('the legacy chain still reproduces the hash a bound device already has', () => {
  // Mirrors device-binding.ts. If the chain there changes, this is the canary: every
  // device currently in the database was bound under legacy(), so legacy() must keep
  // producing that value until the migration has swept everyone.
  const legacy = (env) => env.CLERK_SECRET_KEY
    || env.DATABASE_URL
    || 'latewatch-development-device-secret';
  const primary = (env) => env.DEVICE_BINDING_SECRET || legacy(env);
  const hash = (secret, token) => createHmac('sha256', secret).update(token).digest('hex');

  const token = 'device-token-used-by-an-already-bound-phone';
  const beforeRotation = { CLERK_SECRET_KEY: 'sk_live_example' };
  const afterRotation = { ...beforeRotation, DEVICE_BINDING_SECRET: 'an-independent-secret' };

  const storedHash = hash(legacy(beforeRotation), token);

  // Unset: the new code must hash exactly as the old code did.
  assert.equal(hash(primary(beforeRotation), token), storedHash);

  // Set: the primary hash moves, but the legacy hash still matches the stored row, which is
  // what lets resolveDeviceHash recognise the device and rewrite it.
  assert.notEqual(hash(primary(afterRotation), token), storedHash);
  assert.equal(hash(legacy(afterRotation), token), storedHash);
});
