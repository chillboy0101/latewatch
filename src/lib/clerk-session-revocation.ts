import 'server-only';

import { createClerkClient } from '@clerk/backend';
import { normalizeStaffEmail } from '@/lib/staff-normalize';

type ClerkClient = ReturnType<typeof createClerkClient>;
type ClerkUser = Awaited<ReturnType<ClerkClient['users']['getUser']>>;

export type StaffSessionRevocationResult = {
  revokedSessions: number;
  status: 'clerk_not_configured' | 'no_clerk_user' | 'no_session_id' | 'no_active_sessions' | 'revoked';
  userId: string | null;
};

export class StaffSessionRevocationError extends Error {
  readonly revokedSessions: number;
  readonly userId: string;

  constructor(message: string, input: { revokedSessions: number; userId: string }) {
    super(message);
    this.name = 'StaffSessionRevocationError';
    this.revokedSessions = input.revokedSessions;
    this.userId = input.userId;
  }
}

function getClerkClient() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

function isNotFound(error: unknown) {
  const details = error as { errors?: Array<{ code?: string; message?: string }>; message?: string; status?: number };
  const text = [
    details.message,
    ...(details.errors || []).flatMap((item) => [item.code, item.message]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return details.status === 404 || text.includes('not found') || text.includes('not_found');
}

async function getUserById(client: ClerkClient, userId: string | null | undefined) {
  if (!userId) return null;

  try {
    return await client.users.getUser(userId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function findUserByEmail(client: ClerkClient, email: string | null | undefined) {
  const normalizedEmail = normalizeStaffEmail(email);
  if (!normalizedEmail) return null;

  const users = await client.users.getUserList({
    emailAddress: [normalizedEmail],
    limit: 1,
  });

  return users.data[0] || null;
}

async function resolveClerkUser(client: ClerkClient, input: {
  deviceUserId?: string | null;
  staffEmail?: string | null;
}) {
  return await getUserById(client, input.deviceUserId)
    || await findUserByEmail(client, input.staffEmail);
}

async function getActiveSessions(client: ClerkClient, userId: string) {
  const sessions = [];
  const limit = 100;
  let offset = 0;
  let totalCount = 0;

  do {
    const page = await client.sessions.getSessionList({
      limit,
      offset,
      status: 'active',
      userId,
    });
    sessions.push(...page.data);
    totalCount = page.totalCount;
    offset += page.data.length;
  } while (sessions.length < totalCount && offset > 0);

  return sessions;
}

export function isStaffSessionRevocationError(error: unknown): error is StaffSessionRevocationError {
  return error instanceof StaffSessionRevocationError;
}

export async function revokeStaffLoginSessions(input: {
  deviceUserId?: string | null;
  staffEmail?: string | null;
}): Promise<StaffSessionRevocationResult> {
  const client = getClerkClient();
  if (!client) {
    return { revokedSessions: 0, status: 'clerk_not_configured', userId: null };
  }

  const user: ClerkUser | null = await resolveClerkUser(client, input);
  if (!user) {
    return { revokedSessions: 0, status: 'no_clerk_user', userId: null };
  }

  const sessions = await getActiveSessions(client, user.id);
  if (sessions.length === 0) {
    return { revokedSessions: 0, status: 'no_active_sessions', userId: user.id };
  }

  let revokedSessions = 0;
  for (const session of sessions) {
    try {
      await client.sessions.revokeSession(session.id);
      revokedSessions += 1;
    } catch {
      throw new StaffSessionRevocationError(
        'Could not revoke all active Clerk sessions for this staff member.',
        { revokedSessions, userId: user.id },
      );
    }
  }

  return { revokedSessions, status: 'revoked', userId: user.id };
}

export async function revokeStaffLoginSessionById(input: {
  expectedUserId?: string | null;
  sessionId?: string | null;
}): Promise<StaffSessionRevocationResult> {
  const client = getClerkClient();
  if (!client) {
    return { revokedSessions: 0, status: 'clerk_not_configured', userId: null };
  }

  if (!input.sessionId) {
    return { revokedSessions: 0, status: 'no_session_id', userId: input.expectedUserId || null };
  }

  try {
    const session = await client.sessions.getSession(input.sessionId);
    if (input.expectedUserId && session.userId !== input.expectedUserId) {
      return { revokedSessions: 0, status: 'no_clerk_user', userId: session.userId };
    }

    if (session.status !== 'active') {
      return { revokedSessions: 0, status: 'no_active_sessions', userId: session.userId };
    }

    await client.sessions.revokeSession(session.id);
    return { revokedSessions: 1, status: 'revoked', userId: session.userId };
  } catch (error) {
    if (isNotFound(error)) {
      return { revokedSessions: 0, status: 'no_active_sessions', userId: input.expectedUserId || null };
    }

    throw new StaffSessionRevocationError(
      'Could not revoke the old trusted-device Clerk session for this staff member.',
      { revokedSessions: 0, userId: input.expectedUserId || 'unknown' },
    );
  }
}
