import type { NextConfig } from "next";

// Local UI harness (scripts/ui-shots.mjs): swap Clerk's client package for a signed-in mock so
// pages can be screenshotted without Clerk. Only in `next dev` on a developer machine — never
// in a production build and never on Vercel.
const uiHarness =
  process.env.LATEWATCH_UI_HARNESS === "1" &&
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL;

const nextConfig: NextConfig = {
  ...(uiHarness ? { devIndicators: false as const } : {}),
  // The old Settings and Account pages were removed: Clerk's profile menu (top right) manages
  // the account, and Backups now live on Exports. Old bookmarks land somewhere useful.
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
