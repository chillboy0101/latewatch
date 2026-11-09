import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { allowRequest } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);

// A report is a few KB (the browser caps every field); anything much bigger isn't one.
const MAX_REPORT_BYTES = 16_384;
// A broken screen reports once or twice; a page reports the history limit once.
const MAX_REPORTS_PER_MINUTE = 10;

// Reads the body, giving up as soon as it passes the limit (null), so nothing big is parsed.
async function readSmallBody(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_REPORT_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPORT_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// A screen broke in someone's browser (app/global-error): log what happened so it can be fixed.
// Only signed-in staff get here (the proxy guards /api), every field is capped, and each account
// may send only a few a minute, so reports can't flood the log.
export async function POST(request: NextRequest) {
  const raw = await readSmallBody(request).catch(() => null);
  if (raw === null) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Not a report: nothing to log.
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new NextResponse(null, { status: 204 });

  const report = body as Record<string, unknown>;
  const { userId } = await auth();
  const limit = await allowRequest(`client-errors:${userId ?? 'signed-out'}`, MAX_REPORTS_PER_MINUTE, 60);
  if (!limit.allowed) {
    return new NextResponse(null, { headers: { 'Retry-After': String(limit.retryAfterSeconds) }, status: 429 });
  }
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
