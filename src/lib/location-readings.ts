// The phone's recent location readings on the check-in screen. Check-in uses the clear reading the
// screen already has (no waiting for a new one), and one vague reading does not undo a clear one
// from a few seconds before.

export type LocationReading = { accuracy: number; latitude: number; longitude: number; timestamp: string };

/** Readings up to this old still count (the server accepts readings up to 60 s old). */
export const RECENT_READING_MS = 20_000;
/** A reading at least this precise is used straight away. */
export const CLEAR_READING_METERS = 20;
/** How long a check-in waits for a clear reading when the phone only has vague ones. */
export const CLEAR_READING_WAIT_MS = 2_000;
const KEEP_MS = 60_000;
const MAX_READINGS = 40;
const CLOCK_SLACK_MS = 10_000;

const readingTime = (reading: LocationReading) => Date.parse(reading.timestamp);

/** Adds a reading (once), oldest first, keeping the last minute. */
export function rememberReading(readings: LocationReading[], reading: LocationReading, now = Date.now()) {
  if (!Number.isFinite(readingTime(reading)) || !Number.isFinite(reading.accuracy)) return readings;
  const kept = [...readings.filter((item) => item.timestamp !== reading.timestamp), reading]
    .filter((item) => now - readingTime(item) <= KEEP_MS)
    .sort((a, b) => readingTime(a) - readingTime(b))
    .slice(-MAX_READINGS);
  readings.splice(0, readings.length, ...kept);
  return readings;
}

/**
 * The reading to judge "at the office" by: the latest when it is clear; otherwise the newest clear
 * one from the last 20 s; otherwise the least vague recent one. Null when nothing is recent.
 */
export function pickReading(readings: LocationReading[], now = Date.now()) {
  const recent = readings.filter((item) => {
    const age = now - readingTime(item);
    return age <= RECENT_READING_MS && age >= -CLOCK_SLACK_MS;
  });
  if (recent.length === 0) return null;
  const latest = recent[recent.length - 1];
  if (latest.accuracy <= CLEAR_READING_METERS) return latest;
  const clear = recent.filter((item) => item.accuracy <= CLEAR_READING_METERS);
  if (clear.length > 0) return clear[clear.length - 1];
  return recent.reduce((best, item) => (item.accuracy < best.accuracy ? item : best));
}
