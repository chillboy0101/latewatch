import { clerkClient, clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/check-in(.*)',
  '/account(.*)',
  '/settings(.*)',
  '/api/(.*)',
]);

const isOrgRequiredRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/check-in(.*)',
  '/settings(.*)',
  '/api/(.*)',
]);

const isStaffCheckInRoute = createRouteMatcher([
  '/check-in(.*)',
  '/api/attendance/check-in(.*)',
]);

const isAdminRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/settings(.*)',
  '/api/attendance(.*)',
  '/api/audit-trail(.*)',
  '/api/calendar(.*)',
  '/api/dashboard(.*)',
  '/api/entries(.*)',
  '/api/emergency-contacts(.*)',
  '/api/export(.*)',
  '/api/exports(.*)',
  '/api/payments(.*)',
  '/api/seed(.*)',
  '/api/staff(.*)',
]);

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

function getAdminUserIds() {
  return new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function getAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function roleFromMetadata(value: unknown) {
  const metadata = asRecord(value);
  const role = metadata?.role;

  return typeof role === 'string' ? role.toLowerCase() : null;
}

function roleFromSessionClaims(sessionClaims: Record<string, unknown> | null | undefined) {
  if (!sessionClaims) return null;

  const directRole = sessionClaims.role;
  if (typeof directRole === 'string') return directRole.toLowerCase();

  return roleFromMetadata(sessionClaims.metadata)
    || roleFromMetadata(sessionClaims.publicMetadata)
    || roleFromMetadata(sessionClaims.privateMetadata);
}

function orgIdFromSessionClaims(sessionClaims: Record<string, unknown> | null | undefined) {
  if (!sessionClaims) return null;

  const org = asRecord(sessionClaims.o);
  const orgId = org?.id || sessionClaims.org_id || sessionClaims.orgId;

  return typeof orgId === 'string' && orgId.trim() ? orgId : null;
}

function requiredOrganizationId() {
  return process.env.CLERK_ORGANIZATION_ID?.trim() || null;
}

function hasRequiredOrganization(sessionClaims: Record<string, unknown> | null | undefined) {
  const activeOrgId = orgIdFromSessionClaims(sessionClaims);
  if (!activeOrgId) return false;

  const requiredOrgId = requiredOrganizationId();
  return !requiredOrgId || activeOrgId === requiredOrgId;
}

function organizationRequiredResponse(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'LateWatch organization access required. Ask an admin to invite this account.' },
      { status: 403 },
    );
  }

  return NextResponse.redirect(new URL('/access-required', req.url));
}

async function getClerkUserAccess(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress
      || user.emailAddresses[0]?.emailAddress
      || null;

    return {
      email: email?.toLowerCase() || null,
      role: roleFromMetadata(user.privateMetadata) || roleFromMetadata(user.publicMetadata),
    };
  } catch (error) {
    console.error('Failed to resolve Clerk admin role:', error);
    return { email: null, role: null };
  }
}

async function isAdminSession(userId: string | null | undefined, sessionClaims: Record<string, unknown> | null | undefined) {
  if (!userId) return false;

  if (getAdminUserIds().has(userId)) {
    return true;
  }

  if (roleFromSessionClaims(sessionClaims) === 'admin') {
    return true;
  }

  const userAccess = await getClerkUserAccess(userId);

  return userAccess.role === 'admin'
    || Boolean(userAccess.email && getAdminEmails().has(userAccess.email));
}

function forbiddenResponse(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  return NextResponse.redirect(new URL('/check-in?admin=required', req.url));
}

const handler = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        const session = await auth.protect();
        if (isOrgRequiredRoute(req) && !hasRequiredOrganization(session.sessionClaims)) {
          return organizationRequiredResponse(req);
        }
        if (!isStaffCheckInRoute(req) && isAdminRoute(req)) {
          if (!(await isAdminSession(session.userId, session.sessionClaims))) {
            return forbiddenResponse(req);
          }
        }
      }
      return NextResponse.next();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    '/dashboard(.*)',
    '/staff(.*)',
    '/emergency-contacts(.*)',
    '/entries(.*)',
    '/attendance(.*)',
    '/wifi(.*)',
    '/exports(.*)',
    '/payments(.*)',
    '/calendar(.*)',
    '/audit-trail(.*)',
    '/check-in(.*)',
    '/account(.*)',
    '/settings(.*)',
    '/api/(.*)',
    '/trpc/(.*)',
  ],
};
