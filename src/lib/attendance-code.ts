import 'server-only';

import { createHmac } from 'crypto';

const CODE_PATTERN = /^[A-F0-9]{6}$/;

function getAttendanceCodeSecret() {
  return process.env.ATTENDANCE_QR_SECRET
    || process.env.CLERK_SECRET_KEY
    || process.env.DATABASE_URL
    || 'latewatch-development-attendance-secret';
}

export function normalizeAttendanceCode(value: unknown) {
  return typeof value === 'string'
    ? value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 6)
    : '';
}

export function getAttendanceCode(dateKey: string) {
  return createHmac('sha256', getAttendanceCodeSecret())
    .update(`latewatch:attendance:${dateKey}`)
    .digest('hex')
    .toUpperCase()
    .slice(0, 6);
}

export function isValidAttendanceCode(dateKey: string, value: unknown) {
  const code = normalizeAttendanceCode(value);
  return CODE_PATTERN.test(code) && code === getAttendanceCode(dateKey);
}
