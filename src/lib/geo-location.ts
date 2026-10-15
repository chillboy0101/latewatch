import { metersBeyondBoundary, parseOfficeBoundary } from '@/lib/office-boundary';

export const DEFAULT_OFFICE_RADIUS_METERS = 80;
export const DEFAULT_MAX_LOCATION_ACCURACY_METERS = 75;
export const DEFAULT_MAX_LOCATION_AGE_MS = 60_000;
export const DEFAULT_LOCATION_FUTURE_TOLERANCE_MS = 10_000;

export type LocationVerificationResult =
  | 'LOCATION_VERIFIED'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_INVALID'
  | 'LOCATION_STALE'
  | 'LOCATION_ACCURACY_WEAK'
  | 'LOCATION_MOCKED'
  | 'OUTSIDE_OFFICE_LOCATION'
  | 'OFFICE_LOCATION_NOT_CONFIGURED';

export type LocationEvidenceInput = {
  accuracy?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  mocked?: boolean | string | null;
  timestamp?: Date | string | number | null;
};

export type OfficeLocationPolicy = {
  /** The grounds as a shape (see office-boundary.ts); when set it replaces the circle. */
  boundary?: unknown;
  latitude?: number | string | null;
  longitude?: number | string | null;
  maxAccuracyMeters?: number | string | null;
  radiusMeters?: number | string | null;
};

export type NormalizedLocationEvidence = {
  accuracy: number;
  latitude: number;
  locationAt: Date;
  longitude: number;
  mocked: boolean;
};

export type LocationValidationResult = {
  accuracy: number | null;
  distanceMeters: number | null;
  latitude: number | null;
  locationAt: Date | null;
  longitude: number | null;
  message: string;
  ok: boolean;
  result: LocationVerificationResult;
};

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeLocationEvidence(
  evidence: LocationEvidenceInput | null | undefined,
): NormalizedLocationEvidence | null {
  if (!evidence) return null;

  const latitude = toFiniteNumber(evidence.latitude);
  const longitude = toFiniteNumber(evidence.longitude);
  const accuracy = toFiniteNumber(evidence.accuracy);
  const locationAt = normalizeDate(evidence.timestamp);
  const mocked = evidence.mocked === true || evidence.mocked === 'true';

  if (latitude === null || longitude === null || accuracy === null || !locationAt) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (accuracy < 0) return null;

  return {
    accuracy,
    latitude,
    locationAt,
    longitude,
    mocked,
  };
}

export function getDistanceMeters(
  pointA: { latitude: number; longitude: number },
  pointB: { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeA = toRadians(pointA.latitude);
  const latitudeB = toRadians(pointB.latitude);
  const deltaLatitude = toRadians(pointB.latitude - pointA.latitude);
  const deltaLongitude = toRadians(pointB.longitude - pointA.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function configuredOfficeLocation(office: OfficeLocationPolicy | null | undefined) {
  const latitude = toFiniteNumber(office?.latitude);
  const longitude = toFiniteNumber(office?.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const radiusMeters = toFiniteNumber(office?.radiusMeters) || DEFAULT_OFFICE_RADIUS_METERS;
  const maxAccuracyMeters = toFiniteNumber(office?.maxAccuracyMeters) || DEFAULT_MAX_LOCATION_ACCURACY_METERS;

  return {
    boundary: parseOfficeBoundary(office?.boundary),
    latitude,
    longitude,
    maxAccuracyMeters: Math.max(1, maxAccuracyMeters),
    radiusMeters: Math.max(1, radiusMeters),
  };
}

export function validateAttendanceLocation({
  evidence,
  maxAgeMs = DEFAULT_MAX_LOCATION_AGE_MS,
  now = new Date(),
  office,
}: {
  evidence: LocationEvidenceInput | null | undefined;
  maxAgeMs?: number;
  now?: Date;
  office: OfficeLocationPolicy | null | undefined;
}): LocationValidationResult {
  const configuredOffice = configuredOfficeLocation(office);
  if (!configuredOffice) {
    return {
      accuracy: null,
      distanceMeters: null,
      latitude: null,
      locationAt: null,
      longitude: null,
      message: 'Office location has not been configured yet.',
      ok: false,
      result: 'OFFICE_LOCATION_NOT_CONFIGURED',
    };
  }

  const normalized = normalizeLocationEvidence(evidence);
  if (!normalized) {
    return {
      accuracy: null,
      distanceMeters: null,
      latitude: null,
      locationAt: null,
      longitude: null,
      message: 'A fresh device location is required.',
      ok: false,
      result: evidence ? 'LOCATION_INVALID' : 'LOCATION_REQUIRED',
    };
  }

  const ageMs = now.getTime() - normalized.locationAt.getTime();
  const distanceMeters = getDistanceMeters(configuredOffice, normalized);
  const base = {
    accuracy: normalized.accuracy,
    distanceMeters,
    latitude: normalized.latitude,
    locationAt: normalized.locationAt,
    longitude: normalized.longitude,
  };

  if (normalized.mocked) {
    return {
      ...base,
      message: 'Mock location is enabled. Turn it off and try again.',
      ok: false,
      result: 'LOCATION_MOCKED',
    };
  }

  if (ageMs > maxAgeMs || ageMs < -DEFAULT_LOCATION_FUTURE_TOLERANCE_MS) {
    return {
      ...base,
      message: 'Location is too old. Please refresh your location and try again.',
      ok: false,
      result: 'LOCATION_STALE',
    };
  }

  if (configuredOffice.boundary) {
    const beyondMeters = metersBeyondBoundary(configuredOffice.boundary, normalized);
    if (beyondMeters > 0) {
      return {
        ...base,
        message: `You appear to be ${Math.max(1, Math.round(beyondMeters))}m outside the office grounds.`,
        ok: false,
        result: 'OUTSIDE_OFFICE_LOCATION',
      };
    }
  } else if (distanceMeters > configuredOffice.radiusMeters) {
    return {
      ...base,
      message: `You appear to be ${Math.round(distanceMeters)}m from the office location.`,
      ok: false,
      result: 'OUTSIDE_OFFICE_LOCATION',
    };
  }

  if (normalized.accuracy > configuredOffice.maxAccuracyMeters) {
    return {
      ...base,
      message: `Location accuracy is weak (${Math.round(normalized.accuracy)}m). Move to an open area and try again.`,
      ok: false,
      result: 'LOCATION_ACCURACY_WEAK',
    };
  }

  return {
    ...base,
    message: 'Office location verified.',
    ok: true,
    result: 'LOCATION_VERIFIED',
  };
}

export type LocationFix = {
  accuracy: number;
  latitude: number;
  longitude: number;
};

/**
 * One precise point from a burst of readings taken standing still: readings much worse than the
 * best are dropped, the rest are averaged with weight 1/accuracy² (a ±4 m reading counts four
 * times a ±8 m one). The accuracy reported is the honest one: never better than the best single
 * reading, and wider if the readings disagree with each other.
 */
export function averageLocationFixes(fixes: LocationFix[]) {
  const usable = fixes.filter((fix) => (
    Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude) && Number.isFinite(fix.accuracy) && fix.accuracy > 0
  ));
  if (usable.length === 0) return null;

  const best = Math.min(...usable.map((fix) => fix.accuracy));
  const kept = usable.filter((fix) => fix.accuracy <= Math.max(10, best * 2));
  const weights = kept.map((fix) => 1 / (fix.accuracy * fix.accuracy));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const latitude = kept.reduce((sum, fix, index) => sum + fix.latitude * weights[index], 0) / totalWeight;
  const longitude = kept.reduce((sum, fix, index) => sum + fix.longitude * weights[index], 0) / totalWeight;
  const centre = { latitude, longitude };
  const spread = Math.sqrt(
    kept.reduce((sum, fix, index) => sum + weights[index] * getDistanceMeters(centre, fix) ** 2, 0) / totalWeight,
  );

  return {
    accuracy: Math.max(best, spread),
    latitude,
    longitude,
    readings: kept.length,
  };
}
