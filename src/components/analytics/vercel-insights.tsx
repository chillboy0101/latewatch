'use client';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const RECORD_ID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

/**
 * The address sent with a page view or a speed reading, without anything about a person: no query
 * string, and record ids (a receipt's, say) become ":id", so pages group by screen.
 */
export function withoutIds<T extends { url: string }>(event: T): T {
  try {
    const url = new URL(event.url);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(RECORD_ID, '/:id');
    return { ...event, url: url.toString() };
  } catch {
    return event;
  }
}

// Vercel Web Analytics (visitors and page views) and Speed Insights (how fast screens load).
export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={withoutIds} />
      <SpeedInsights beforeSend={withoutIds} />
    </>
  );
}
