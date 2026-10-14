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

  if (adminUserIdsFromEnv().has(userId)) {
    return true;
  }

  if (roleFromSessionClaims(sessionClaims) === 'admin') {
    return true;
  }

  if (isAdminRole(roleFromOrganizationClaims(sessionClaims))) {
    return true;
  }

  const userAccess = await getClerkUserAccess(userId);

  return isAdminRole(userAccess.role)
    || Boolean(userAccess.email && adminEmailsFromEnv().has(userAccess.email));
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
        // Access comes from the Staff list: an active (non-archived) staff record for one of the
        // account's verified emails, or an admin. No Clerk organisation is involved.
        if (
          isStaffRequiredRoute(req)
          && !(await hasActiveStaffAccess(session.userId))
          && !(await isAdminSession(session.userId, session.sessionClaims))
        ) {
          return staffAccessRequiredResponse(req);
        }
        if (!isStaffCheckInRoute(req) && isAdminRoute(req)) {
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
