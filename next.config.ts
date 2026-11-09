import type { NextConfig } from "next";

// Local UI harness (scripts/ui-shots.mjs): swap Clerk's client package for a signed-in mock so
// pages can be screenshotted without Clerk. Only in `next dev` on a developer machine — never
// in a production build and never on Vercel.
const uiHarness =
  process.env.LATEWATCH_UI_HARNESS === "1" &&
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL;

// Sent with every response. LateWatch is never shown inside another site's frame, so a page that
// tries (to trick someone into tapping Sign in, Sign out or an approval) is refused; files are only
// ever read as the type they are served as; other sites learn no more than the origin from a link;
// and only LateWatch's own pages may ask for location (sign-in checks) — nothing may use the camera,
// microphone or payment features.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  ...(uiHarness ? { devIndicators: false as const } : {}),
  // The old Settings and Account pages were removed: Clerk's profile menu (top right) manages
  // the account, and Backups now live on Exports. Old bookmarks land somewhere useful.
  async headers() {
    return [{ headers: securityHeaders, source: "/:path*" }];
  },
  async redirects() {
    return [
      { destination: "/exports", permanent: false, source: "/settings" },
      { destination: "/dashboard", permanent: false, source: "/settings/:path*" },
      { destination: "/", permanent: false, source: "/account/:path*" },
      { destination: "/", permanent: false, source: "/account" },
    ];
  },
  turbopack: {
    root: process.cwd(),
    ...(uiHarness ? { resolveAlias: { "@clerk/nextjs": "./tests/ui/clerk-mock.tsx" } } : {}),
  },
};

export default nextConfig;
