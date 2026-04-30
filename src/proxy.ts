import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/entries(.*)',
  '/exports(.*)',
  '/calendar(.*)',
  '/audit-trail(.*)',
  '/settings(.*)',
  '/api/(.*)',
]);

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

const handler = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
      return NextResponse.next();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    '/dashboard(.*)',
    '/staff(.*)',
    '/entries(.*)',
    '/exports(.*)',
    '/calendar(.*)',
    '/audit-trail(.*)',
    '/settings(.*)',
    '/api/(.*)',
    '/trpc/(.*)',
  ],
};
