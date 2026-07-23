// Context-free role helpers shared by the edge proxy (src/proxy.ts) and the
// server-side route guards (src/lib/auth/roles.ts). This module must stay free of
// any Node- or Clerk-specific imports so it can run in the edge middleware runtime.

export function normalizeRole(role: unknown): string | null {
  return typeof role === 'string' && role.trim()
    ? role.trim().toLowerCase()
    : null;
}

export function roleFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  return normalizeRole((metadata as Record<string, unknown>).role);
}

export function adminUserIdsFromEnv(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function adminEmailsFromEnv(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
