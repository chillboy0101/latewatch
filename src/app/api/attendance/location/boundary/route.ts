import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { officeLocation } from '@/db/schema';
import { getAccraClock, getOfficeLocationsForAttendance } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';
import { DEFAULT_MAX_LOCATION_ACCURACY_METERS } from '@/lib/geo-location';
import { boundaryCircle, type OfficeBoundary, parseOfficeBoundary } from '@/lib/office-boundary';
import { resolveOfficeLocationForDate } from '@/lib/office-location-policy';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const ACTIONS = ['save', 'propose', 'approve', 'discard', 'remove'] as const;
type BoundaryAction = (typeof ACTIONS)[number];

// The office grounds shape belongs to the default office location (a programme location keeps
// its own circle).
async function readDefaultLocation() {
  const locations = await getOfficeLocationsForAttendance();
  return resolveOfficeLocationForDate(locations.filter((location) => location.locationKind === 'default'), getAccraClock().dateKey);
}

function serialize(row: typeof officeLocation.$inferSelect) {
  return {
    active: parseOfficeBoundary(row.boundaryJson),
    draft: parseOfficeBoundary(row.boundaryDraftJson),
    locationId: row.id,
    pin: { latitude: Number(row.latitude), longitude: Number(row.longitude), radiusMeters: row.radiusMeters },
  };
}

export async function GET() {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
  try {
    const row = await readDefaultLocation();
    if (!row) return NextResponse.json({ active: null, draft: null, locationId: null, pin: null });
    return NextResponse.json(serialize(row), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load the office boundary:', error);
    return NextResponse.json({ error: 'Could not load the office boundary' }, { status: 500 });
  }
}

// The pin and circle made from a boundary: the pin in the middle of the grounds, the circle covering
// every edge (used if the boundary is ever turned off).
function pinFromBoundary(boundary: OfficeBoundary) {
  const circle = boundaryCircle(boundary);
  return {
    latitude: circle.latitude.toFixed(7),
    longitude: circle.longitude.toFixed(7),
    radiusMeters: Math.min(1000, Math.max(10, circle.radiusMeters)),
  };
}

// save: this shape is the office boundary from now on. propose: keep a shape for review (no effect
// on sign-in). approve: the proposed shape becomes the office boundary. discard: drop the
// proposal. remove: back to the circle.
export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  const body = await request.json().catch(() => ({}));
  const action = ACTIONS.find((item) => item === body?.action) as BoundaryAction | undefined;
  if (!action) return NextResponse.json({ error: 'Unknown boundary action' }, { status: 400 });

  try {
    const row = await readDefaultLocation();
    if (!row) {
      // No office yet: saving the first area creates it, with the pin and circle made from it.
      const firstArea = action === 'save' ? parseOfficeBoundary(body?.boundary) : null;
      if (!firstArea) return NextResponse.json({ error: 'Draw the office area first' }, { status: 409 });
      const user = await currentUser();
      const [created] = await db.insert(officeLocation).values({
        boundaryJson: firstArea,
        isActive: true,
        locationKind: 'default',
        maxAccuracyMeters: DEFAULT_MAX_LOCATION_ACCURACY_METERS,
        name: 'Office Location',
        source: 'map',
        updatedByEmail: user?.emailAddresses[0]?.emailAddress || 'unknown',
        updatedByUserId: user?.id || null,
        ...pinFromBoundary(firstArea),
      }).returning();
      await writeAuditEvent({
        entityType: 'office_location',
        entityId: created.id,
        action: 'CREATE',
        before: null,
        after: { boundary: firstArea, ...pinFromBoundary(firstArea) },
        reason: 'office-boundary-save',
      });
      publishRealtime('attendance', 'invalidate', { reason: 'attendance-office-location' });
      return NextResponse.json(serialize(created));
    }
    const active = parseOfficeBoundary(row.boundaryJson);
    const draft = parseOfficeBoundary(row.boundaryDraftJson);

    let changes: Partial<typeof officeLocation.$inferInsert>;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    const pinBefore = { latitude: row.latitude, longitude: row.longitude, radiusMeters: row.radiusMeters };
    if (action === 'save') {
      const saved = parseOfficeBoundary(body?.boundary);
      if (!saved) {
        return NextResponse.json({
          error: 'This area cannot be used: mark at least 3 corners, with the road edge in front of the grounds.',
        }, { status: 400 });
      }
      const pin = pinFromBoundary(saved);
      changes = { boundaryDraftJson: null, boundaryJson: saved, ...pin };
      before = { boundary: active, ...pinBefore };
      after = { boundary: saved, ...pin };
    } else if (action === 'propose') {
      const proposed = parseOfficeBoundary(body?.boundary);
      if (!proposed) {
        return NextResponse.json({
          error: 'This shape cannot be used: mark at least 3 corners, with the road edge in front of the grounds.',
        }, { status: 400 });
      }
      changes = { boundaryDraftJson: proposed };
      before = { proposedBoundary: draft };
      after = { proposedBoundary: proposed };
    } else if (action === 'approve') {
      if (!draft) return NextResponse.json({ error: 'There is no proposed boundary to approve' }, { status: 409 });
      const pin = pinFromBoundary(draft);
      changes = { boundaryDraftJson: null, boundaryJson: draft, ...pin };
      before = { boundary: active, ...pinBefore };
      after = { boundary: draft, ...pin };
    } else if (action === 'discard') {
      changes = { boundaryDraftJson: null };
      before = { proposedBoundary: draft };
      after = { proposedBoundary: null };
    } else {
      changes = { boundaryJson: null };
      before = { boundary: active };
      after = { boundary: null, radiusMeters: row.radiusMeters };
    }

    const [updated] = await db.update(officeLocation)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(officeLocation.id, row.id))
      .returning();
    await writeAuditEvent({
      entityType: 'office_location',
      entityId: row.id,
      action: 'UPDATE',
      before,
      after,
      reason: `office-boundary-${action}`,
    });
    if (action === 'save' || action === 'approve' || action === 'remove') {
      // Phones re-read the office policy, so their live "At office" check follows the new boundary.
      publishRealtime('attendance', 'invalidate', { reason: 'attendance-office-location' });
      publishRealtime('dashboard', 'invalidate', { reason: 'attendance-office-location' });
    }
    publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-office-location' });
    return NextResponse.json(serialize(updated || row));
  } catch (error) {
    console.error('Failed to update the office boundary:', error);
    return NextResponse.json({ error: 'Could not update the office boundary' }, { status: 500 });
  }
}
