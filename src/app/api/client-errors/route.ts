import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);

// A screen broke in someone's browser (app/global-error): log what happened so it can be fixed.
// Only signed-in staff get here (the proxy guards /api), and every field is capped so a report
// can't flood the log.
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new NextResponse(null, { status: 204 });

  const report = body as Record<string, unknown>;
  const { userId } = await auth();
  console.error('[client-error]', JSON.stringify({
    digest: text(report.digest, 80),
    historyLength: typeof report.historyLength === 'number' ? report.historyLength : undefined,
    message: text(report.message, 500),
    name: text(report.name, 80),
    path: text(report.path, 200),
    stack: text(report.stack, 2000),
    trail: Array.isArray(report.trail) ? report.trail.slice(-16).map((step) => text(step, 120)) : undefined,
    userAgent: text(request.headers.get('user-agent'), 200),
    userId,
  }));
  return new NextResponse(null, { status: 204 });
}
