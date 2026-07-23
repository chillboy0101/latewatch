import { currentUser } from '@clerk/nextjs/server';
import {
  adminEmailsFromEnv,
  adminUserIdsFromEnv,
  roleFromMetadata,
} from '@/lib/auth/role-config';

export interface UserInfo {
  id: string;
  email: string;
  role: string;
}

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

function primaryEmail(user: ClerkUser) {
  return user.primaryEmailAddress?.emailAddress
    || user.emailAddresses[0]?.emailAddress
    || 'unknown';
}

function resolveRole(user: ClerkUser) {
  const email = primaryEmail(user).toLowerCase();

  if (adminUserIdsFromEnv().has(user.id) || adminEmailsFromEnv().has(email)) {
    return 'admin';
  }

  return roleFromMetadata(user.privateMetadata)
    || roleFromMetadata(user.publicMetadata)
    || 'viewer';
}

export async function requireRole(allowedRoles: string[]): Promise<UserInfo> {
  const user = await currentUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const role = resolveRole(user);
  const allowed = new Set(allowedRoles.map((allowedRole) => allowedRole.toLowerCase()));

  if (!allowed.has(role)) {
    throw new Error('Forbidden');
  }

  return {
    id: user.id,
    email: primaryEmail(user),
    role,
  };
}

/**
 * Route-handler friendly wrapper around {@link requireRole}. Returns `null` when
 * the caller is allowed, or a `{ error, status }` object to hand straight back to
 * the client. Used as a defense-in-depth guard inside API routes so a route stays
 * protected even if the edge proxy is bypassed or misconfigured.
 */
export async function enforceRole(
  allowedRoles: string[],
): Promise<{ error: string; status: number } | null> {
  try {
    await requireRole(allowedRoles);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return { error: message, status: message === 'Forbidden' ? 403 : 401 };
  }
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  try {
    const user = await currentUser();

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: primaryEmail(user),
      role: resolveRole(user),
    };
  } catch (error) {
    console.warn('Failed to get current user:', error);
    return null;
  }
}
