import { currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { officeLocation } from '@/db/schema';
import { getAccraClock, getOfficeLocationsForAttendance, resolveClientIpInfo } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import {
  DEFAULT_MAX_LOCATION_ACCURACY_METERS,
  DEFAULT_OFFICE_RADIUS_METERS,
} from '@/lib/geo-location';
import { isValidDateKey, overlapsOfficeLocationSchedule, resolveOfficeLocationForDate } from '@/lib/office-location-policy';
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

function optionalText(value: unknown, maxLength = 240) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function serializeLocation(row: typeof officeLocation.$inferSelect | null) {
  return row
    ? {
        archivedAt: row.archivedAt,
        formattedAddress: row.formattedAddress,
        googlePlaceId: row.googlePlaceId,
        id: row.id,
        isActive: row.isActive,
        latitude: row.latitude,
        locationKind: row.locationKind,
        longitude: row.longitude,
        maxAccuracyMeters: row.maxAccuracyMeters,
        name: row.name,
        radiusMeters: row.radiusMeters,
        scheduleEndDate: row.scheduleEndDate,
        scheduleStartDate: row.scheduleStartDate,
        source: row.source,
        updatedAt: row.updatedAt,
        updatedByEmail: row.updatedByEmail,
      }
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const dateKey = isValidDateKey(date) ? date! : null;
    const clock = getAccraClock();
    const currentIpInfo = await resolveClientIpInfo(request);
    const locations = await getOfficeLocationsForAttendance();
    const defaultLocation = resolveOfficeLocationForDate(
      locations.filter((location) => location.locationKind === 'default'),
      dateKey || clock.dateKey,
    );
    const resolvedLocation = resolveOfficeLocationForDate(locations, dateKey || clock.dateKey);
    const scheduledLocations = locations
      .filter((location) => location.locationKind === 'scheduled')
      .sort((a, b) => String(a.scheduleStartDate || '').localeCompare(String(b.scheduleStartDate || '')));

    return NextResponse.json({
      configured: Boolean(resolvedLocation),
      currentIp: currentIpInfo.ip,
      currentIpSource: currentIpInfo.source,
      date: dateKey,
      defaultLocation: serializeLocation(defaultLocation),
      googleMapsConfigured: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
      location: serializeLocation(resolvedLocation),
      scheduledLocations: scheduledLocations.map(serializeLocation),
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
      date: null,
      defaultLocation: null,
      googleMapsConfigured: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
      location: null,
      message: 'Office location setup is not ready yet. Refresh and try again.',
      scheduledLocations: [],
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
    const mode = body?.mode === 'scheduled' ? 'scheduled' : 'default';
    const latitude = finiteNumber(body?.latitude);
    const longitude = finiteNumber(body?.longitude);
    const name = optionalText(body?.name) || (mode === 'scheduled' ? 'Program Location' : 'Office Location');

    if (latitude === null || latitude < -90 || latitude > 90) {
      return NextResponse.json({ error: 'Valid latitude is required' }, { status: 400 });
    }

    if (longitude === null || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: 'Valid longitude is required' }, { status: 400 });
    }

    const radiusMeters = boundedInteger(body?.radiusMeters, DEFAULT_OFFICE_RADIUS_METERS, 10, 1000);
    const maxAccuracyMeters = boundedInteger(body?.maxAccuracyMeters, DEFAULT_MAX_LOCATION_ACCURACY_METERS, 10, 500);
    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const scheduleStartDate = optionalText(body?.scheduleStartDate, 10);
    const scheduleEndDate = optionalText(body?.scheduleEndDate, 10);
    const allLocationsBefore = await getOfficeLocationsForAttendance();
    const before = mode === 'scheduled'
      ? null
      : resolveOfficeLocationForDate(
        allLocationsBefore.filter((location) => location.locationKind === 'default'),
        new Date().toISOString().slice(0, 10),
      );
    const now = new Date();

    if (mode === 'scheduled') {
      if (!isValidDateKey(scheduleStartDate) || !isValidDateKey(scheduleEndDate)) {
        return NextResponse.json({ error: 'Program start and end dates are required' }, { status: 400 });
      }

      if (scheduleStartDate! > scheduleEndDate!) {
        return NextResponse.json({ error: 'Program end date must be after the start date' }, { status: 400 });
      }

      if (overlapsOfficeLocationSchedule(allLocationsBefore, {
        endDate: scheduleEndDate!,
        startDate: scheduleStartDate!,
      })) {
        return NextResponse.json({ error: 'A program location already covers one or more selected dates' }, { status: 409 });
      }
    }

    if (mode === 'default') {
      await db.update(officeLocation)
        .set({ isActive: false, updatedAt: now })
        .where(and(
          eq(officeLocation.isActive, true),
          eq(officeLocation.locationKind, 'default'),
          isNull(officeLocation.archivedAt),
        ));
    }

    const [createdLocation] = await db.insert(officeLocation)
      .values({
        formattedAddress: optionalText(body?.formattedAddress, 500),
        googlePlaceId: optionalText(body?.googlePlaceId, 160),
        isActive: true,
        latitude: latitude.toFixed(7),
        locationKind: mode,
        longitude: longitude.toFixed(7),
        maxAccuracyMeters,
        name,
        radiusMeters,
        scheduleEndDate: mode === 'scheduled' ? scheduleEndDate : null,
        scheduleStartDate: mode === 'scheduled' ? scheduleStartDate : null,
        source: optionalText(body?.source, 40) || (body?.googlePlaceId ? 'google' : 'manual'),
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
      mode,
      success: true,
    });
  } catch (error) {
    console.error('Failed to update office location:', error);
    return NextResponse.json({ error: 'Failed to update office location' }, { status: 500 });
  }
}
