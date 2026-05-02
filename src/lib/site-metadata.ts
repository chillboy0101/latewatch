export const SITE_NAME = "LateWatch";
export const SITE_TITLE = "LateWatch - GRA Attendance & Lateness Tracking";
export const SITE_DESCRIPTION =
  "Secure attendance check-in, check-out, lateness penalties, audit trails, emergency contacts, and Excel exports for Ghana Revenue Authority teams.";
export const SITE_URL_FALLBACK = "https://latewatch.vercel.app";

export const SITE_KEYWORDS = [
  "LateWatch",
  "GRA attendance",
  "Ghana Revenue Authority attendance",
  "lateness tracking",
  "employee attendance",
  "office check-in",
  "attendance audit trail",
  "lateness penalties",
  "attendance exports",
];

export function getSiteUrl(path = "/") {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || SITE_URL_FALLBACK;
  const baseUrl = configuredUrl.endsWith("/") ? configuredUrl : `${configuredUrl}/`;

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return new URL(path, SITE_URL_FALLBACK).toString();
  }
}
