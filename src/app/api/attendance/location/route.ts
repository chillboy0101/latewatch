import { currentUser } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { officeLocation } from '@/db/schema';
import { getActiveOfficeLocation, resolveClientIpInfo } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import {
  DEFAULT_MAX_LOCATION_ACCURACY_METERS,
  DEFAULT_OFFICE_RADIUS_METERS,
} from '@/lib/geo-location';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

function finiteNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = finiteNumber(value);
  if (number === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function serializeLocation(row: typeof officeLocation.$inferSelect | null) {
  return row
    ? {
        id: row.id,
        isActive: row.isActive,
        latitude: row.latitude,
        longitude: row.longitude,
        maxAccuracyMeters: row.maxAccuracyMeters,
        name: row.name,
        radiusMeters: row.radiusMeters,
        updatedAt: row.updatedAt,
        updatedByEmail: row.updatedByEmail,
      }
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const currentIpInfo = await resolveClientIpInfo(request);
    const location = await getActiveOfficeLocation();

    return NextResponse.json({
      configured: Boolean(location),
      currentIp: currentIpInfo.ip,
      currentIpSource: currentIpInfo.source,
      location: serializeLocation(location),
      storageAvailable: true,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load office location:', error);
    const currentIpInfo = await resolveClientIpInfo(request).catch(() => ({
      ip: 'unknown',
      source: null,
    }));

    return NextResponse.json({
      configured: false,
      currentIp: currentIpInfo.ip,
      currentIpSource: currentIpInfo.source,
      location: null,
      message: 'Office location setup is not ready yet. Refresh and try again.',
      storageAvailable: false,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const latitude = finiteNumber(body?.latitude);
    const longitude = finiteNumber(body?.longitude);
    const name = typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim()
      : 'Office Location';

    if (latitude === null || latitude < -90 || latitude > 90) {
      return NextResponse.json({ error: 'Valid latitude is required' }, { status: 400 });
    }

    if (longitude === null || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: 'Valid longitude is required' }, { status: 400 });
    }

    const radiusMeters = boundedInteger(body?.radiusMeters, DEFAULT_OFFICE_RADIUS_METERS, 10, 1000);
    const maxAccuracyMeters = boundedInteger(body?.maxAccuracyMeters, DEFAULT_MAX_LOCATION_ACCURACY_METERS, 10, 500);
    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const before = await getActiveOfficeLocation();
    const now = new Date();

    await db.update(officeLocation)
      .set({ isActive: false, updatedAt: now })
      .where(eq(officeLocation.isActive, true));

    const [createdLocation] = await db.insert(officeLocation)
      .values({
        isActive: true,
        latitude: latitude.toFixed(7),
        longitude: longitude.toFixed(7),
        maxAccuracyMeters,
        name,
        radiusMeters,
        updatedAt: now,
        updatedByEmail: actorEmail,
        updatedByUserId: user.id,
      })
      .returning();

    const recentLocations = await db.select()
      .from(officeLocation)
      .orderBy(desc(officeLocation.updatedAt))
      .limit(1);

    const location = createdLocation || recentLocations[0] || null;

    await writeAuditEvent({
      entityType: 'office_location',
      entityId: location?.id || 'office-location',
      action: before ? 'UPDATE' : 'CREATE',
      before,
      after: location,
      actor: { email: actorEmail, id: user.id },
      reason: 'attendance-office-location',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-office-location' });
    publishRealtime('attendance', 'invalidate', { reason: 'attendance-office-location' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-office-location' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-office-location' });

    return NextResponse.json({
      configured: true,
      location: serializeLocation(location),
      success: true,
    });
  } catch (error) {
    console.error('Failed to update office location:', error);
    return NextResponse.json({ error: 'Failed to update office location' }, { status: 500 });
  }
}
