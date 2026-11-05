import { clerkClient, clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import {
  adminEmailsFromEnv,
  adminUserIdsFromEnv,
  isAdminRole,
  normalizeRole,
  roleFromOrganizationClaims,
  roleFromMetadata,
} from '@/lib/auth/role-config';
import { hasActiveStaffAccess } from '@/lib/auth/staff-access';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/location(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/contributions(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/check-in(.*)',
  '/api/(.*)',
]);

// Routes only active staff (or admins) may use.
const isStaffRequiredRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/location(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/contributions(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/check-in(.*)',
  '/api/(.*)',
]);

const isStaffCheckInRoute = createRouteMatcher([
  '/check-in(.*)',
  '/api/attendance/check-in(.*)',
]);

// Cron endpoints carry no login session; each one checks CRON_SECRET and the caller itself.
const isCronReminderRoute = createRouteMatcher([
  '/api/attendance/reminders(.*)',
  '/api/attendance/no-show-sign-in/apply',
  '/api/backups/weekly',
  '/api/calendar/sync/monthly',
]);

const isAdminRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/location(.*)',
  '/wifi(.*)',
  '/exports(.*)',
  '/payments(.*)',
  '/contributions(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/api/attendance(.*)',
  '/api/audit-trail(.*)',
  '/api/calendar(.*)',
  '/api/dashboard(.*)',
  '/api/entries(.*)',
  '/api/emergency-contacts(.*)',
  '/api/export(.*)',
  '/api/exports(.*)',
  '/api/payments(.*)',
  '/api/contributions(.*)',
  '/api/seed(.*)',
  '/api/staff(.*)',
]);

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

function roleFromSessionClaims(sessionClaims: Record<string, unknown> | null | undefined) {
  if (!sessionClaims) return null;

  const directRole = normalizeRole(sessionClaims.role);
  if (directRole) return directRole;

  return roleFromMetadata(sessionClaims.metadata)
    || roleFromMetadata(sessionClaims.publicMetadata)
    || roleFromMetadata(sessionClaims.privateMetadata);
}

function staffAccessRequiredResponse(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'LateWatch staff access required. Ask an admin to add this account\'s email as staff.' },
      { status: 403 },
    );
  }

  return NextResponse.redirect(new URL('/access-required', req.url));
}

// Admin by the account list or the session token alone, with no call to Clerk's servers.
function isAdminFromSession(userId: string | null | undefined, sessionClaims: Record<string, unknown> | null | undefined) {
  if (!userId) return false;
  return adminUserIdsFromEnv().has(userId)
    || roleFromSessionClaims(sessionClaims) === 'admin'
    || isAdminRole(roleFromOrganizationClaims(sessionClaims));
}

// Admin by the role or email on the Clerk account. Kept a minute (a "no" 10 seconds), like the staff
// check, so admin pages and requests don't each wait on Clerk's servers; a failed lookup is not kept.
const ADMIN_TTL_MS = 60_000;
const NOT_ADMIN_TTL_MS = 10_000;
const adminLookupCache = new Map<string, { admin: boolean; expiresAt: number }>();

async function isAdminByClerkAccount(userId: string) {
  const cached = adminLookupCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.admin;

  let admin: boolean;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = (user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || '').toLowerCase();
    const role = roleFromMetadata(user.privateMetadata) || roleFromMetadata(user.publicMetadata);
    admin = isAdminRole(role) || Boolean(email && adminEmailsFromEnv().has(email));
  } catch (error) {
    console.error('Failed to resolve Clerk admin role:', error);
    return false;
  }

  adminLookupCache.set(userId, { admin, expiresAt: Date.now() + (admin ? ADMIN_TTL_MS : NOT_ADMIN_TTL_MS) });
  return admin;
}

async function isAdminSession(userId: string | null | undefined, sessionClaims: Record<string, unknown> | null | undefined) {
  if (!userId) return false;
  return isAdminFromSession(userId, sessionClaims) || isAdminByClerkAccount(userId);
}

function forbiddenResponse(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  return NextResponse.redirect(new URL('/check-in?admin=required', req.url));
}

function authNotConfiguredResponse(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication is not configured' }, { status: 503 });
  }

  return NextResponse.redirect(new URL('/access-required', req.url));
}

const handler = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isCronReminderRoute(req)) {
        return NextResponse.next();
      }

      if (isProtectedRoute(req)) {
        const session = await auth.protect();
        // An admin named by the account list or the session token passes both checks below with no
        // lookups (no call to Clerk's servers or the database), so admin screens open sooner.
        const adminFromSession = isAdminFromSession(session.userId, session.sessionClaims);
        // Access comes from the Staff list: an active (non-archived) staff record for one of the
        // account's verified emails, or an admin. No Clerk organisation is involved.
        if (
          isStaffRequiredRoute(req)
          && !adminFromSession
          && !(await hasActiveStaffAccess(session.userId))
          && !(await isAdminSession(session.userId, session.sessionClaims))
        ) {
          return staffAccessRequiredResponse(req);
        }
        if (!isStaffCheckInRoute(req) && isAdminRoute(req) && !adminFromSession) {
          if (!(await isAdminSession(session.userId, session.sessionClaims))) {
            return forbiddenResponse(req);
          }
        }
      }
      return NextResponse.next();
    })
  : (req: Request) => {
      // Fail closed in production: a missing Clerk configuration must not silently
      // turn every matched route into a public endpoint. In development we still
      // pass through so the app is usable without Clerk keys.
      if (process.env.NODE_ENV === 'production') {
        return authNotConfiguredResponse(req);
      }
      return NextResponse.next();
    };

export default handler;

export const config = {
  matcher: [
    '/dashboard(.*)',
    '/staff(.*)',
    '/emergency-contacts(.*)',
    '/entries(.*)',
    '/attendance(.*)',
    '/location(.*)',
    '/wifi(.*)',
    '/exports(.*)',
    '/payments(.*)',
    '/contributions(.*)',
    '/calendar(.*)',
    '/audit-trail(.*)',
    '/check-in(.*)',
    '/api/(.*)',
    '/trpc/(.*)',
  ],
};
