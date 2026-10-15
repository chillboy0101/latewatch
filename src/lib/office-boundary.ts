// The office grounds as a shape instead of a circle: the outline an admin marked on the satellite
// map (wall and car parks), with room around it for phone error, and never more than a few metres
// past the road edge at the front, so the far side of the road stays out. Pure maths: used by the
// server when checking a sign-in and by the phone for its live "At office" check.

export type LatLng = { latitude: number; longitude: number };

export type OfficeBoundary = {
  /** The grounds, corners in order round the outline. */
  outline: LatLng[];
  /** How far outside the outline a reading may land (phone error). */
  roomMeters: number;
  /** The road edge, and how far past it a reading may land. */
  road: { allowanceMeters: number; from: LatLng; to: LatLng } | null;
};

export const DEFAULT_BOUNDARY_ROOM_METERS = 25;
export const DEFAULT_ROAD_ALLOWANCE_METERS = 12;
export const MAX_BOUNDARY_CORNERS = 60;
const MAX_ROOM_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_000;

type Point = { x: number; y: number };

function finite(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function parseLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  const latitude = finite(point.latitude);
  const longitude = finite(point.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: Math.round(latitude * 1e7) / 1e7, longitude: Math.round(longitude * 1e7) / 1e7 };
}

function clampMeters(value: unknown, fallback: number) {
  const number = finite(value);
  return number === null ? fallback : Math.min(MAX_ROOM_METERS, Math.max(0, Math.round(number)));
}

// Metres east/north of an origin. Exact enough over a few hundred metres.
function projector(origin: LatLng) {
  const metersPerDegree = (Math.PI / 180) * EARTH_RADIUS_METERS;
  const cosLatitude = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    toLatLng: (point: Point): LatLng => ({
      latitude: origin.latitude + point.y / metersPerDegree,
      longitude: origin.longitude + point.x / (metersPerDegree * cosLatitude),
    }),
    toPoint: (point: LatLng): Point => ({
      x: (point.longitude - origin.longitude) * metersPerDegree * cosLatitude,
      y: (point.latitude - origin.latitude) * metersPerDegree,
    }),
  };
}

function insidePolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function boundaryGeometry(boundary: OfficeBoundary) {
  const { toLatLng, toPoint } = projector(boundary.outline[0]);
  const outline = boundary.outline.map(toPoint);
  let road: { allowance: number; normal: Point; start: Point } | null = null;
  if (boundary.road) {
    const start = toPoint(boundary.road.from);
    const end = toPoint(boundary.road.to);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0) {
      let normal = { x: (end.y - start.y) / length, y: -(end.x - start.x) / length };
      // Point "past the road" away from the grounds: the outline's middle is on the near side.
      const middle = {
        x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
        y: outline.reduce((sum, point) => sum + point.y, 0) / outline.length,
      };
      if ((middle.x - start.x) * normal.x + (middle.y - start.y) * normal.y > 0) normal = { x: -normal.x, y: -normal.y };
      road = { allowance: boundary.road.allowanceMeters, normal, start };
    }
  }

  const pastRoad = (point: Point) => (road
    ? (point.x - road.start.x) * road.normal.x + (point.y - road.start.y) * road.normal.y
    : Number.NEGATIVE_INFINITY);
  const beyond = (point: Point) => {
    const outside = insidePolygon(point, outline)
      ? 0
      : Math.min(...outline.map((corner, index) => segmentDistance(point, corner, outline[(index + 1) % outline.length])));
    const pastOutline = outside - boundary.roomMeters;
    return road ? Math.max(pastOutline, pastRoad(point) - road.allowance) : pastOutline;
  };
  return { beyond, outline, pastRoad, toLatLng, toPoint };
}

/**
 * A boundary saved by an admin (or null when it is missing or unusable). Every corner must be on
 * the grounds side of the road line, or the road rule would cut off part of the grounds.
 */
export function parseOfficeBoundary(value: unknown): OfficeBoundary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.outline) || raw.outline.length < 3 || raw.outline.length > MAX_BOUNDARY_CORNERS) return null;
  const outline = raw.outline.map(parseLatLng);
  if (outline.some((point) => point === null)) return null;

  let road: OfficeBoundary['road'] = null;
  if (raw.road && typeof raw.road === 'object') {
    const rawRoad = raw.road as Record<string, unknown>;
    const from = parseLatLng(rawRoad.from);
    const to = parseLatLng(rawRoad.to);
    if (!from || !to) return null;
    road = { allowanceMeters: clampMeters(rawRoad.allowanceMeters, DEFAULT_ROAD_ALLOWANCE_METERS), from, to };
  }

  const boundary: OfficeBoundary = {
    outline: outline as LatLng[],
    road,
    roomMeters: clampMeters(raw.roomMeters, DEFAULT_BOUNDARY_ROOM_METERS),
  };
  const geometry = boundaryGeometry(boundary);
  // A flat (zero-area) outline or a road line through the grounds is not a boundary.
  const area = Math.abs(geometry.outline.reduce((sum, point, index) => {
    const next = geometry.outline[(index + 1) % geometry.outline.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (area < 1) return null;
  if (road && geometry.outline.some((point) => geometry.pastRoad(point) > road.allowanceMeters)) return null;
  return boundary;
}

/** How far a reading is beyond the boundary, in metres: 0 or less means inside. */
export function metersBeyondBoundary(boundary: OfficeBoundary, point: LatLng) {
  const geometry = boundaryGeometry(boundary);
  return geometry.beyond(geometry.toPoint(point));
}

/**
 * The boundary line for drawing on a map, as short segments (marching squares over a grid).
 * Accurate to about the grid step.
 */
export function boundaryContour(boundary: OfficeBoundary, stepMeters = 2): [LatLng, LatLng][] {
  const geometry = boundaryGeometry(boundary);
  const margin = boundary.roomMeters + stepMeters * 2;
  const xs = geometry.outline.map((point) => point.x);
  const ys = geometry.outline.map((point) => point.y);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const columns = Math.ceil((Math.max(...xs) + margin - minX) / stepMeters);
  const rows = Math.ceil((Math.max(...ys) + margin - minY) / stepMeters);
  const values: number[][] = [];
  for (let row = 0; row <= rows; row += 1) {
    values.push([]);
    for (let column = 0; column <= columns; column += 1) {
      values[row].push(geometry.beyond({ x: minX + column * stepMeters, y: minY + row * stepMeters }));
    }
  }

  const segments: [LatLng, LatLng][] = [];
  const edgePoint = (x1: number, y1: number, v1: number, x2: number, y2: number, v2: number): Point => {
    const t = v1 === v2 ? 0.5 : v1 / (v1 - v2);
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + column * stepMeters;
      const y = minY + row * stepMeters;
      const corners = [
        { v: values[row][column], x, y },
        { v: values[row][column + 1], x: x + stepMeters, y },
        { v: values[row + 1][column + 1], x: x + stepMeters, y: y + stepMeters },
        { v: values[row + 1][column], x, y: y + stepMeters },
      ];
      // Where the boundary crosses this cell's sides (inside <= 0 < outside).
      const crossings: Point[] = [];
      for (let side = 0; side < 4; side += 1) {
        const a = corners[side];
        const b = corners[(side + 1) % 4];
        if ((a.v <= 0) !== (b.v <= 0)) crossings.push(edgePoint(a.x, a.y, a.v, b.x, b.y, b.v));
      }
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        segments.push([geometry.toLatLng(crossings[index]), geometry.toLatLng(crossings[index + 1])]);
      }
    }
  }
  return segments;
}
