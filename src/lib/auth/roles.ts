// lib/auth/roles.ts
import { currentUser } from '@clerk/nextjs/server';

export interface UserInfo {
  id: string;
  email: string;
  role: string;
}

export async function requireRole(allowedRoles: string[]): Promise<UserInfo> {
  const user = await currentUser();
  
  if (!user) {
    throw new Error('Unauthorized');
  }

  const role = user.privateMetadata?.role as string | undefined;
  
  if (!role || !allowedRoles.includes(role)) {
    throw new Error('Forbidden');
  }

  const email = user.emailAddresses[0]?.emailAddress || 'unknown';

  return {
    id: user.id,
    email,
    role: role,
  };
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  try {
    const user = await currentUser();
    
    if (!user) {
      return null;
    }

    const role = user.privateMetadata?.role as string | undefined;
    const email = user.emailAddresses[0]?.emailAddress || 'unknown';

    return {
      id: user.id,
      email,
      role: role || 'viewer',
    };
  } catch (error) {
    console.warn('Failed to get current user:', error);
    return null;
  }
}
