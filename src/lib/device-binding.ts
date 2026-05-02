import 'server-only';

import { createHmac } from 'crypto';

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{24,160}$/;

function getDeviceSecret() {
  return process.env.DEVICE_BINDING_SECRET
    || process.env.CLERK_SECRET_KEY
    || process.env.DATABASE_URL
    || 'latewatch-development-device-secret';
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
  return createHmac('sha256', getDeviceSecret())
    .update(deviceToken)
    .digest('hex');
}
