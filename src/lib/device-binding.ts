import 'server-only';

import { createHmac } from 'crypto';

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{24,160}$/;

// The secret a device token is signed with. DEVICE_BINDING_SECRET is the one to set; the
// rest of the chain is what deployments used before it existed, kept only so an already
// bound device keeps working until it re-keys (see device-rekey.ts).
function legacyDeviceSecret() {
  return process.env.CLERK_SECRET_KEY
    || process.env.DATABASE_URL
    || 'latewatch-development-device-secret';
}

function primaryDeviceSecret() {
  return process.env.DEVICE_BINDING_SECRET || legacyDeviceSecret();
}

export function normalizeDeviceToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return DEVICE_TOKEN_PATTERN.test(token) ? token : null;
}

export function getDeviceTokenFromRequest(request: Request, body?: Record<string, unknown>) {
  return normalizeDeviceToken(body?.deviceToken)
    || normalizeDeviceToken(request.headers.get('x-latewatch-device'));
}

export function hashDeviceToken(deviceToken: string) {
  return createHmac('sha256', primaryDeviceSecret())
    .update(deviceToken)
    .digest('hex');
}

/**
 * The hash this token would have had under the previous secret, or null when nothing has
 * been rotated — which is the case until DEVICE_BINDING_SECRET is set, making the whole
 * re-key path a no-op.
 */
export function legacyHashDeviceToken(deviceToken: string) {
  const legacy = legacyDeviceSecret();
  if (legacy === primaryDeviceSecret()) return null;

  return createHmac('sha256', legacy)
    .update(deviceToken)
    .digest('hex');
}
