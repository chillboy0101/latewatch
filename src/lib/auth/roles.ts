import { currentUser } from '@clerk/nextjs/server';

export interface UserInfo {
  id: string;
  email: string;
  role: string;
}

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

function normalizeRole(role: unknown) {
  return typeof role === 'string' && role.trim()
    ? role.trim().toLowerCase()
    : null;
}

function metadataRole(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  return normalizeRole((metadata as Record<string, unknown>).role);
}

function configuredAdminUserIds() {
  return new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function configuredAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function primaryEmail(user: ClerkUser) {
  return user.primaryEmailAddress?.emailAddress
    || user.emailAddresses[0]?.emailAddress
    || 'unknown';
}

function resolveRole(user: ClerkUser) {
  const email = primaryEmail(user).toLowerCase();

  if (configuredAdminUserIds().has(user.id) || configuredAdminEmails().has(email)) {
    return 'admin';
  }

  return metadataRole(user.privateMetadata)
    || metadataRole(user.publicMetadata)
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
