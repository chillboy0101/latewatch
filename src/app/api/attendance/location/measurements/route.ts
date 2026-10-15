import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const MAX_POINTS = 60;
const MAX_NOTE_LENGTH = 60;

type MeasuredPoint = {
  accuracy: number;
  latitude: number;
  longitude: number;
  note: string | null;
  readings: number;
  recordedAt: string | null;
};

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePoint(value: unknown): MeasuredPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  const latitude = finiteNumber(point.latitude);
  const longitude = finiteNumber(point.longitude);
  const accuracy = finiteNumber(point.accuracy);
  const readings = finiteNumber(point.readings);
  if (latitude === null || longitude === null || accuracy === null || readings === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (accuracy <= 0 || accuracy > 500 || readings < 1 || readings > 500) return null;
  const recordedAt = typeof point.recordedAt === 'string' && !Number.isNaN(new Date(point.recordedAt).getTime())
    ? new Date(point.recordedAt).toISOString()
    : null;
  return {
    accuracy: Math.round(accuracy * 10) / 10,
    latitude: Math.round(latitude * 1e7) / 1e7,
    longitude: Math.round(longitude * 1e7) / 1e7,
    note: typeof point.note === 'string' && point.note.trim() ? point.note.trim().slice(0, MAX_NOTE_LENGTH) : null,
    readings: Math.round(readings),
    recordedAt,
  };
}

// Corners of the office grounds measured on site (Location page → Measure grounds). They are kept
// in the audit trail for working out the office boundary; the office location itself is unchanged.
export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  const body = await request.json().catch(() => ({}));
  const rawPoints = Array.isArray(body?.points) ? body.points : [];
  if (rawPoints.length === 0 || rawPoints.length > MAX_POINTS) {
    return NextResponse.json({ error: `Record between 1 and ${MAX_POINTS} corners` }, { status: 400 });
  }
  const points = rawPoints.map(parsePoint);
  if (points.some((point: MeasuredPoint | null) => point === null)) {
    return NextResponse.json({ error: 'One of the corners is not a valid reading' }, { status: 400 });
  }

  try {
    const measurementId = randomUUID();
    await writeAuditEvent({
      entityType: 'office_grounds_measurement',
      entityId: measurementId,
      action: 'CREATE',
      before: null,
      after: {
        device: request.headers.get('user-agent')?.slice(0, 200) || null,
        pointCount: points.length,
        points,
      },
      reason: 'office-grounds-measured',
    });
    return NextResponse.json({ id: measurementId, pointCount: points.length }, { status: 201 });
  } catch (error) {
    console.error('Failed to save office grounds measurement:', error);
    return NextResponse.json({ error: 'Could not save the corners' }, { status: 500 });
  }
}
