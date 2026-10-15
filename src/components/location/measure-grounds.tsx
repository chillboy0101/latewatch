'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPinned, Save, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { averageLocationFixes, type LocationFix } from '@/lib/geo-location';
import { cn } from '@/lib/utils';

// Walk the office grounds and record each corner of the wall and the car park. Each corner is a
// burst of readings taken standing still, averaged into one precise point. Saving keeps the
// corners in the audit trail for working out the office boundary; it does not change the
// office location.

type Corner = {
  accuracy: number;
  latitude: number;
  longitude: number;
  note: string;
  readings: number;
  recordedAt: string;
};

type Office = { latitude: number; longitude: number; radiusMeters: number } | null;

const STORAGE_KEY = 'latewatch.measure-grounds.v1';
const MIN_RECORD_MS = 6_000;
const MAX_RECORD_MS = 15_000;
const POLL_MS = 2_000;
const GOOD_READING_METERS = 10;
const GOOD_READINGS_NEEDED = 5;
const WEAK_CORNER_METERS = 15;

function readStoredCorners(): Corner[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function geolocationMessage(error: GeolocationPositionError) {
  if (error.code === 1) return 'Location access is blocked for this browser. Allow it, then try again.';
  if (error.code === 2) return 'The phone could not find its location here. Step into the open and try again.';
  return 'No reading came through in time. Try again.';
}

export function MeasureGroundsCard({ office }: { office: Office }) {
  const [corners, setCorners] = useState<Corner[]>([]);
  const [recording, setRecording] = useState<{ best: number | null; readings: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fixesRef = useRef<LocationFix[]>([]);
  const lastReadingAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const activeRef = useRef(false);
  const watchRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  // Corners survive a reload mid-walk (kept on this phone only until saved).
  useEffect(() => {
    setCorners(readStoredCorners());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(corners));
    } catch {
      // Storage blocked: the corners stay on screen for this visit.
    }
  }, [corners]);

  const stopListening = useCallback(() => {
    activeRef.current = false;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    watchRef.current = null;
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  useEffect(() => stopListening, [stopListening]);

  const finishCorner = useCallback(() => {
    if (!activeRef.current) return;
    stopListening();
    setRecording(null);
    const point = averageLocationFixes(fixesRef.current);
    if (!point) {
      setError('No reading came through. Check location access and try again.');
      return;
    }
    setCorners((current) => [...current, { ...point, note: '', recordedAt: new Date().toISOString() }]);
  }, [stopListening]);

  const recordCorner = useCallback(() => {
    if (!navigator.geolocation) {
      setError('This browser does not support location.');
      return;
    }
    setError('');
    setNotice('');
    fixesRef.current = [];
    lastReadingAtRef.current = 0;
    startedAtRef.current = Date.now();
    activeRef.current = true;
    setRecording({ best: null, readings: 0 });

    const onReading = (position: GeolocationPosition) => {
      // The listener and the 2-second check can hand over the same reading: count it once.
      if (!activeRef.current || position.timestamp === lastReadingAtRef.current) return;
      lastReadingAtRef.current = position.timestamp;
      fixesRef.current.push({
        accuracy: position.coords.accuracy,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const best = Math.min(...fixesRef.current.map((fix) => fix.accuracy));
      setRecording({ best, readings: fixesRef.current.length });
      const good = fixesRef.current.filter((fix) => fix.accuracy <= GOOD_READING_METERS).length;
      if (good >= GOOD_READINGS_NEEDED && Date.now() - startedAtRef.current >= MIN_RECORD_MS) finishCorner();
    };
    const onFailure = (geoError: GeolocationPositionError) => {
      if (!activeRef.current || fixesRef.current.length > 0) return;
      stopListening();
      setRecording(null);
      setError(geolocationMessage(geoError));
    };
    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_RECORD_MS };

    // A phone standing still may report rarely, so ask every 2 s as well as listening.
    watchRef.current = navigator.geolocation.watchPosition(onReading, onFailure, options);
    pollRef.current = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(onReading, () => undefined, options);
    }, POLL_MS);
    timeoutRef.current = window.setTimeout(finishCorner, MAX_RECORD_MS);
  }, [finishCorner, stopListening]);

  const cancelRecording = useCallback(() => {
    stopListening();
    setRecording(null);
  }, [stopListening]);

  async function saveCorners() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/attendance/location/measurements', {
        body: JSON.stringify({ points: corners }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not save the corners (${response.status})`);
      setNotice(`Saved ${corners.length} corner${corners.length === 1 ? '' : 's'}. The office location is unchanged.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the corners');
    } finally {
      setSaving(false);
    }
  }

  function clearCorners() {
    if (!window.confirm('Remove all recorded corners from this phone?')) return;
    setCorners([]);
    setNotice('');
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MapPinned className="h-5 w-5 text-primary" />
          Measure grounds
        </h2>
        {corners.length > 0 && !recording && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearCorners}>Clear</Button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Stand at each corner of the wall and car park, going round in order. Tap Record corner and hold still for about 10 seconds.
        </p>

        {corners.length > 0 && (
          <>
            <GroundsSketch corners={corners} office={office} />
            <ol className="divide-y divide-border rounded-md border border-border">
              {corners.map((corner, index) => (
                <li key={corner.recordedAt} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-semibold', corner.accuracy > WEAK_CORNER_METERS && 'text-warning')}>
                      ±{Math.round(corner.accuracy)} m{corner.accuracy > WEAK_CORNER_METERS ? ' · weak, record it again if you can' : ''}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {corner.latitude.toFixed(6)}, {corner.longitude.toFixed(6)} · {corner.readings} reading{corner.readings === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Input
                    aria-label={`Note for corner ${index + 1}`}
                    className="h-9 w-28 text-sm sm:w-40"
                    maxLength={60}
                    placeholder="Note"
                    value={corner.note}
                    onChange={(event) => {
                      const note = event.target.value;
                      setCorners((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, note } : item)));
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove corner ${index + 1}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    onClick={() => setCorners((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={Boolean(recording)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {recording ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-3 text-sm">
            <span className="flex items-center gap-2 font-medium text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Recording… {recording.readings} reading{recording.readings === 1 ? '' : 's'}
              {recording.best !== null ? ` · best ±${Math.round(recording.best)} m` : ''}
            </span>
            <Button variant="outline" size="sm" className="h-8" onClick={cancelRecording}>Cancel</Button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Button className="h-11 gap-2 sm:col-span-1" onClick={recordCorner} disabled={saving}>
              <MapPinned className="h-5 w-5" />
              Record corner
            </Button>
            <Button
              className="h-11 gap-2"
              variant="outline"
              onClick={() => setCorners((current) => current.slice(0, -1))}
              disabled={saving || corners.length === 0}
            >
              <Undo2 className="h-5 w-5" />
              Undo last
            </Button>
            <Button className="h-11 gap-2" variant="outline" onClick={saveCorners} disabled={saving || corners.length === 0}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              Save corners
            </Button>
          </div>
        )}

        {notice && !error && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">{notice}</div>
        )}
        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
      </div>
    </Card>
  );
}

// A to-scale sketch (north up) of the corners recorded so far, with today's office circle dashed.
function GroundsSketch({ corners, office }: { corners: Corner[]; office: Office }) {
  const sketch = useMemo(() => {
    const origin = office || corners[0];
    const metersPerDegree = 111_320;
    const cosLatitude = Math.cos((origin.latitude * Math.PI) / 180);
    const toPoint = (latitude: number, longitude: number) => ({
      x: (longitude - origin.longitude) * metersPerDegree * cosLatitude,
      y: -(latitude - origin.latitude) * metersPerDegree,
    });
    const points = corners.map((corner) => toPoint(corner.latitude, corner.longitude));
    const extents = [...points];
    if (office) {
      extents.push({ x: -office.radiusMeters, y: -office.radiusMeters }, { x: office.radiusMeters, y: office.radiusMeters });
    }
    const minX = Math.min(...extents.map((point) => point.x));
    const maxX = Math.max(...extents.map((point) => point.x));
    const minY = Math.min(...extents.map((point) => point.y));
    const maxY = Math.max(...extents.map((point) => point.y));
    const size = 240;
    const padding = 16;
    const span = Math.max(maxX - minX, maxY - minY, 20);
    const scale = (size - padding * 2) / span;
    const place = (point: { x: number; y: number }) => ({
      x: padding + (point.x - minX) * scale + ((span - (maxX - minX)) * scale) / 2,
      y: padding + (point.y - minY) * scale + ((span - (maxY - minY)) * scale) / 2,
    });
    return {
      office: office ? { ...place({ x: 0, y: 0 }), r: office.radiusMeters * scale } : null,
      points: points.map(place),
      size,
      span: Math.round(span),
    };
  }, [corners, office]);

  const path = sketch.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

  return (
    <figure className="rounded-md border border-border bg-background p-2">
      <svg viewBox={`0 0 ${sketch.size} ${sketch.size}`} className="mx-auto block h-56 w-56" role="img" aria-label="Sketch of the recorded corners">
        {sketch.office && (
          <>
            <circle cx={sketch.office.x} cy={sketch.office.y} r={sketch.office.r} fill="none" className="stroke-muted-foreground" strokeDasharray="4 4" />
            <circle cx={sketch.office.x} cy={sketch.office.y} r={2.5} className="fill-muted-foreground" />
          </>
        )}
        {sketch.points.length > 1 && (
          <path d={`${path}${sketch.points.length > 2 ? ' Z' : ''}`} className="fill-primary/15 stroke-primary" strokeWidth={2} />
        )}
        {sketch.points.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r={8} className="fill-primary" />
            <text x={point.x} y={point.y + 3.5} textAnchor="middle" className="fill-primary-foreground text-[10px] font-semibold">{index + 1}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">
        North is up · about {sketch.span} m across{sketch.office ? ' · dashed: today’s office circle' : ''}
      </figcaption>
    </figure>
  );
}
