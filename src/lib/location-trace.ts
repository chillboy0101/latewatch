// Readings an admin's phone sends while walking the office grounds (Location -> Measure grounds).

const MAX_NOTE_LENGTH = 60;

export type TraceReading = {
  accuracy: number;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  note: string | null;
};

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseTraceReading(value: unknown, now = Date.now()): TraceReading | null {
  if (!value || typeof value !== 'object') return null;
  const reading = value as Record<string, unknown>;
  const latitude = finiteNumber(reading.latitude);
  const longitude = finiteNumber(reading.longitude);
  const accuracy = finiteNumber(reading.accuracy);
  const timestamp = finiteNumber(reading.timestamp);
  if (latitude === null || longitude === null || accuracy === null || timestamp === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (accuracy <= 0 || accuracy > 5000) return null;
  // Readings from the last hour only (a batch can be sent late after a pause, never from the future).
  if (timestamp > now + 60_000 || timestamp < now - 60 * 60 * 1000) return null;
  return {
    accuracy: Math.round(accuracy * 100) / 100,
    capturedAt: new Date(timestamp),
    latitude: Math.round(latitude * 1e7) / 1e7,
    longitude: Math.round(longitude * 1e7) / 1e7,
    note: typeof reading.note === 'string' && reading.note.trim() ? reading.note.trim().slice(0, MAX_NOTE_LENGTH) : null,
  };
}
