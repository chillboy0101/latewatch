import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/emergency-contacts(.*)',
  '/entries(.*)',
  '/attendance(.*)',
  '/exports(.*)',
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
  '/exports(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/settings(.*)',
  '/api/attendance(.*)',
  '/api/audit-trail(.*)',
  '/api/calendar(.*)',
  '/api/dashboard(.*)',
  '/api/entries(.*)',
  '/api/emergency-contacts(.*)',
  '/api/exports(.*)',
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
        if (!isStaffCheckInRoute(req) && isAdminRoute(req)) {
          const adminUserIds = getAdminUserIds();
          if (!session.userId || !adminUserIds.has(session.userId)) {
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
    '/exports(.*)',
    '/calendar(.*)',
    '/audit-trail(.*)',
    '/check-in(.*)',
    '/settings(.*)',
    '/api/(.*)',
    '/trpc/(.*)',
  ],
};
