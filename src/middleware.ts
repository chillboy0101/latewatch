// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/staff(.*)',
  '/entries(.*)',
  '/exports(.*)',
  '/calendar(.*)',
  '/settings(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  try {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
    return NextResponse.next();
  } catch (error) {
    console.error('Middleware error:', error);
    // Don't block requests on middleware errors in production
    return NextResponse.next();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
