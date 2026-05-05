import { API_URL, CLERK_ORGANIZATION_ID } from './config';
import type { AttendanceStatus, LocationEvidence } from './types';

type GetToken = (options?: { organizationId?: string; skipCache?: boolean }) => Promise<string | null>;

type RequestOptions = {
  body?: unknown;
  deviceToken: string;
  getToken: GetToken;
  method?: 'GET' | 'POST';
};

export class LateWatchApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LateWatchApiError';
    this.status = status;
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function requestJson<T>(path: string, options: RequestOptions): Promise<T> {
  const token = await options.getToken(
    CLERK_ORGANIZATION_ID ? { organizationId: CLERK_ORGANIZATION_ID } : undefined,
  );

  if (!token) {
    throw new LateWatchApiError('Sign in again before recording attendance.', 401);
  }

  const response = await fetch(`${API_URL}${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-latewatch-device': options.deviceToken,
    },
    method: options.method || 'GET',
  });
  const body = await readJson(response);

  if (!response.ok) {
    const message = typeof body.error === 'string'
      ? body.error
      : `LateWatch request failed (${response.status})`;
    throw new LateWatchApiError(message, response.status);
  }

  return body as T;
}

export function getAttendanceStatus(options: Omit<RequestOptions, 'body' | 'method'>) {
  return requestJson<AttendanceStatus>('/api/attendance/check-in', options);
}

export function submitAttendanceAction(options: Omit<RequestOptions, 'body' | 'method'> & {
  action: 'check_in' | 'sign_out';
  deviceLabel: string;
  location: LocationEvidence;
}) {
  return requestJson<AttendanceStatus>('/api/attendance/check-in', {
    ...options,
    body: {
      action: options.action,
      deviceLabel: options.deviceLabel,
      deviceToken: options.deviceToken,
      location: options.location,
      source: 'mobile_app',
    },
    method: 'POST',
  });
}

export function requestDeviceTransfer(options: Omit<RequestOptions, 'body' | 'method'> & {
  deviceLabel: string;
  location: LocationEvidence;
}) {
  return requestJson<AttendanceStatus>('/api/attendance/check-in', {
    ...options,
    body: {
      action: 'request_device_transfer',
      deviceLabel: options.deviceLabel,
      deviceToken: options.deviceToken,
      location: options.location,
      source: 'mobile_app',
    },
    method: 'POST',
  });
}
