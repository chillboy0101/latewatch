import { auth } from '@clerk/nextjs/server';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { locationTrace } from '@/db/schema';
import { enforceRole } from '@/lib/auth/roles';
import { parseTraceReading, type TraceReading } from '@/lib/location-trace';

export const dynamic = 'force-dynamic';

const MAX_READINGS = 20;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_TRAIL = 5000;

// This admin's own trail from the last 24 hours, drawn on the grounds map.
export async function GET() {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await db.select({
      accuracy: locationTrace.accuracyMeters,
      capturedAt: locationTrace.capturedAt,
      latitude: locationTrace.latitude,
      longitude: locationTrace.longitude,
      note: locationTrace.note,
    })
      .from(locationTrace)
      .where(and(eq(locationTrace.userId, userId), gt(locationTrace.capturedAt, new Date(Date.now() - KEEP_MS))))
      .orderBy(asc(locationTrace.capturedAt))
      .limit(MAX_TRAIL);
    return NextResponse.json({
      readings: rows.map((row) => ({
        accuracy: Number(row.accuracy),
        capturedAt: row.capturedAt,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        note: row.note,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load live location trail:', error);
    return NextResponse.json({ error: 'Could not load the trail' }, { status: 500 });
  }
}

// An admin's live position while walking the office grounds (Location -> Measure grounds), so the
// grounds can be traced. Temporary: rows older than 24 hours are removed on every write.
export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawReadings = Array.isArray(body?.readings) ? body.readings : [];
  if (rawReadings.length === 0 || rawReadings.length > MAX_READINGS) {
    return NextResponse.json({ error: `Send between 1 and ${MAX_READINGS} readings` }, { status: 400 });
  }
  const now = Date.now();
  const readings = rawReadings.map((reading: unknown) => parseTraceReading(reading, now)).filter(Boolean) as TraceReading[];
  if (readings.length === 0) {
    return NextResponse.json({ error: 'No valid readings' }, { status: 400 });
  }

  try {
    await db.insert(locationTrace).values(readings.map((reading) => ({
      accuracyMeters: reading.accuracy.toFixed(2),
      capturedAt: reading.capturedAt,
      latitude: reading.latitude.toFixed(7),
      longitude: reading.longitude.toFixed(7),
      note: reading.note,
      userId,
    })));
    await db.delete(locationTrace).where(lt(locationTrace.createdAt, new Date(now - KEEP_MS)));
    return NextResponse.json({ saved: readings.length, skipped: rawReadings.length - readings.length });
  } catch (error) {
    console.error('Failed to save live location:', error);
    return NextResponse.json({ error: 'Could not save the live location' }, { status: 500 });
  }
}
