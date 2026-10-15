'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Check, Loader2, Map as MapIcon, Save, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  boundaryContour,
  DEFAULT_BOUNDARY_ROOM_METERS,
  DEFAULT_ROAD_ALLOWANCE_METERS,
  type OfficeBoundary,
} from '@/lib/office-boundary';
import { cn } from '@/lib/utils';

// The office grounds on Esri satellite imagery. Tap the map at each corner of the wall and the car
// parks (drag a number to adjust it), and two points along the road edge in front. Corners can be
// saved for review, or proposed as the office boundary: a proposal changes nothing until an admin
// taps "Use this boundary".

type Office = { latitude: number; longitude: number; radiusMeters: number } | null;
type MapCorner = { id: string; latitude: number; longitude: number; note: string };
type TrailReading = { accuracy: number; latitude: number; longitude: number; note: string | null };
type Boundaries = { active: OfficeBoundary | null; draft: OfficeBoundary | null };
type BoundaryAction = 'approve' | 'discard' | 'propose' | 'remove';

const STORAGE_KEY = 'latewatch.map-corners.v1';
const ROAD_STORAGE_KEY = 'latewatch.map-road.v1';
const MAX_CORNERS = 60;
const TRAIL_MAX_ACCURACY_METERS = 30;
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Powered by Esri | Maxar, Earthstar Geographics';
const CORNER_ICON_CLASS = 'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-md';
const ROAD_ICON_CLASS = 'flex h-5 w-5 items-center justify-center rounded-sm border-2 border-white bg-danger shadow-md';
const COLORS = { active: '#ffffff', corners: '#22c55e', draft: '#22d3ee', road: '#ef4444', walk: '#facc15' };

const BOUNDARY_NOTICES: Record<BoundaryAction, string> = {
  approve: 'The office boundary is on. Sign-ins follow it from now.',
  discard: 'Proposed boundary removed.',
  propose: 'Boundary proposed (cyan). Check it on the map, then tap Use this boundary.',
  remove: 'Back to the circle for sign-in.',
};

const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function readStored(key: string): MapCorner[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(stored) ? stored.filter((corner) => Number.isFinite(corner?.latitude) && Number.isFinite(corner?.longitude)) : [];
  } catch {
    return [];
  }
}

function describeBoundary(boundary: OfficeBoundary) {
  return `${boundary.outline.length} corners · ${boundary.roomMeters} m room${boundary.road ? ` · stops ${boundary.road.allowanceMeters} m past the road` : ''}`;
}

export function GroundsMapCard({ office }: { office: Office }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const boundaryLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const cornerLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const tapModeRef = useRef<'corner' | 'road'>('corner');
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState(false);
  const [corners, setCorners] = useState<MapCorner[]>([]);
  const [roadPoints, setRoadPoints] = useState<MapCorner[]>([]);
  const [tapMode, setTapMode] = useState<'corner' | 'road'>('corner');
  const [boundaries, setBoundaries] = useState<Boundaries | null>(null);
  const [roomMeters, setRoomMeters] = useState(String(DEFAULT_BOUNDARY_ROOM_METERS));
  const [roadAllowanceMeters, setRoadAllowanceMeters] = useState(String(DEFAULT_ROAD_ALLOWANCE_METERS));
  const [walkShown, setWalkShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<BoundaryAction | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    tapModeRef.current = tapMode;
  }, [tapMode]);

  // Corners and the road edge survive a reload (kept on this phone only until saved).
  useEffect(() => {
    setCorners(readStored(STORAGE_KEY));
    setRoadPoints(readStored(ROAD_STORAGE_KEY).slice(-2));
    setStored(true);
  }, []);
  useEffect(() => {
    if (!stored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(corners));
      localStorage.setItem(ROAD_STORAGE_KEY, JSON.stringify(roadPoints));
    } catch {
      // Storage blocked: the corners stay on screen for this visit.
    }
  }, [corners, roadPoints, stored]);

  useEffect(() => {
    let active = true;
    fetch('/api/attendance/location/boundary', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && body) setBoundaries({ active: body.active ?? null, draft: body.draft ?? null });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // The map itself, once the office is known: imagery, the office pin and the walk shared today.
  useEffect(() => {
    if (!office || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current).setView([office.latitude, office.longitude], 18);
      map.attributionControl.setPrefix(false);
      L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 19, maxZoom: 21 }).addTo(map);
      boundaryLayerRef.current = L.layerGroup().addTo(map);
      L.circleMarker([office.latitude, office.longitude], {
        color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1, interactive: false, radius: 5, weight: 2,
      }).addTo(map);
      cornerLayerRef.current = L.layerGroup().addTo(map);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        setNotice('');
        const point = { id: newId(), latitude: round7(event.latlng.lat), longitude: round7(event.latlng.lng), note: '' };
        if (tapModeRef.current === 'road') {
          setRoadPoints((current) => [...current, point].slice(-2));
          return;
        }
        setCorners((current) => (current.length >= MAX_CORNERS ? current : [...current, point]));
      });
      mapRef.current = map;
      setReady(true);

      fetch('/api/attendance/location/trace', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (cancelled || !Array.isArray(body?.readings)) return;
          const readings = body.readings as TrailReading[];
          const path = readings
            .filter((reading) => reading.accuracy <= TRAIL_MAX_ACCURACY_METERS)
            .map((reading) => [reading.latitude, reading.longitude] as [number, number]);
          if (path.length > 1) {
            L.polyline(path, { color: COLORS.walk, interactive: false, opacity: 0.85, weight: 2 }).addTo(map);
            setWalkShown(true);
          }
          for (const reading of readings) {
            if (!reading.note) continue;
            L.circleMarker([reading.latitude, reading.longitude], { color: COLORS.walk, fillOpacity: 1, radius: 4, weight: 2 })
              .bindTooltip(reading.note, { direction: 'top' })
              .addTo(map);
          }
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [office]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  // Today's rule: the office boundary (white) when it is on, otherwise the circle (dashed white),
  // and a proposed boundary (cyan) waiting for approval.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = boundaryLayerRef.current;
    if (!ready || !L || !layer || !office) return;
    layer.clearLayers();
    if (!boundaries?.active) {
      L.circle([office.latitude, office.longitude], {
        color: COLORS.active, dashArray: '6 6', fill: false, interactive: false, radius: office.radiusMeters, weight: 2,
      }).addTo(layer);
    }
    const draw = (boundary: OfficeBoundary, color: string) => {
      L.polygon(boundary.outline.map((point) => [point.latitude, point.longitude] as [number, number]), {
        color, fillOpacity: 0.08, interactive: false, weight: 1,
      }).addTo(layer);
      const segments = boundaryContour(boundary).map(([a, b]) => [[a.latitude, a.longitude], [b.latitude, b.longitude]] as [number, number][]);
      L.polyline(segments, { color, interactive: false, weight: 3 }).addTo(layer);
      if (boundary.road) {
        L.polyline([[boundary.road.from.latitude, boundary.road.from.longitude], [boundary.road.to.latitude, boundary.road.to.longitude]], {
          color: COLORS.road, interactive: false, weight: 2,
        }).addTo(layer);
      }
    };
    if (boundaries?.active) draw(boundaries.active, COLORS.active);
    if (boundaries?.draft) draw(boundaries.draft, COLORS.draft);
  }, [boundaries, office, ready]);

  // Corners as numbered pins (drag to adjust) joined into the grounds outline; the road edge in red.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = cornerLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const points = corners.map((corner) => [corner.latitude, corner.longitude] as [number, number]);
    if (points.length >= 3) L.polygon(points, { color: COLORS.corners, fillOpacity: 0.15, interactive: false, weight: 2 }).addTo(layer);
    if (points.length === 2) L.polyline(points, { color: COLORS.corners, interactive: false, weight: 2 }).addTo(layer);
    if (roadPoints.length === 2) {
      L.polyline(roadPoints.map((point) => [point.latitude, point.longitude] as [number, number]), {
        color: COLORS.road, dashArray: '4 4', interactive: false, weight: 3,
      }).addTo(layer);
    }
    const addPin = (point: MapCorner, html: string, size: number, update: typeof setCorners) => {
      const marker = L.marker([point.latitude, point.longitude], {
        draggable: true,
        icon: L.divIcon({ className: '', html, iconAnchor: [size / 2, size / 2], iconSize: [size, size] }),
        keyboard: false,
      });
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        update((current) => current.map((item) => (item.id === point.id
          ? { ...item, latitude: round7(position.lat), longitude: round7(position.lng) }
          : item)));
      });
      marker.addTo(layer);
    };
    corners.forEach((corner, index) => addPin(corner, `<span class="${CORNER_ICON_CLASS}">${index + 1}</span>`, 28, setCorners));
    roadPoints.forEach((point) => addPin(point, `<span class="${ROAD_ICON_CLASS}"></span>`, 20, setRoadPoints));
  }, [corners, ready, roadPoints]);

  async function saveCorners() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/attendance/location/measurements', {
        body: JSON.stringify({
          points: corners.map(({ latitude, longitude, note }) => ({ latitude, longitude, note })),
          source: 'map',
        }),
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

  async function boundaryAction(action: BoundaryAction) {
    const confirmText = action === 'approve'
      ? 'Use this boundary for every sign-in from now on?'
      : action === 'remove' ? 'Go back to the circle for sign-in?' : null;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const boundary = action === 'propose'
        ? {
            outline: corners.map(({ latitude, longitude }) => ({ latitude, longitude })),
            road: roadPoints.length === 2
              ? { allowanceMeters: Number(roadAllowanceMeters), from: roadPoints[0], to: roadPoints[1] }
              : null,
            roomMeters: Number(roomMeters),
          }
        : undefined;
      const response = await fetch('/api/attendance/location/boundary', {
        body: JSON.stringify({ action, boundary }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not update the boundary (${response.status})`);
      setBoundaries({ active: body.active ?? null, draft: body.draft ?? null });
      setNotice(BOUNDARY_NOTICES[action]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update the boundary');
    } finally {
      setBusy(null);
    }
  }

  function clearCorners() {
    if (!window.confirm('Remove all corners and road points placed on the map?')) return;
    setCorners([]);
    setRoadPoints([]);
    setNotice('');
  }

  const legend = [
    boundaries?.active ? 'white: office boundary' : "dashed white: today's circle",
    boundaries?.draft ? 'cyan: proposed boundary' : null,
    boundaries?.active?.road || boundaries?.draft?.road || roadPoints.length ? 'red: road edge' : null,
    walkShown ? 'yellow: your shared walk' : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MapIcon className="h-5 w-5 text-primary" />
          Mark corners on the map
        </h2>
        {(corners.length > 0 || roadPoints.length > 0) && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearCorners}>Clear</Button>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {tapMode === 'corner'
              ? 'Tap each corner of the wall and car parks, in order. Drag to adjust.'
              : 'Tap 2 points along the road edge in front of the grounds.'}
          </p>
          <div className="inline-flex rounded-md border border-border p-0.5 text-sm" role="group" aria-label="What a tap adds">
            {(['corner', 'road'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={tapMode === mode}
                className={cn('rounded px-3 py-1.5 font-medium', tapMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                onClick={() => setTapMode(mode)}
              >
                {mode === 'corner' ? 'Corner' : 'Road edge'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-md border border-border">
          <div
            ref={containerRef}
            role="application"
            aria-label="Satellite map of the office grounds"
            className="h-[60dvh] min-h-80 w-full bg-muted"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading map…
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{legend}</p>

        {corners.length > 0 && (
          <ol className="divide-y divide-border rounded-md border border-border">
            {corners.map((corner, index) => (
              <li key={corner.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <Input
                  aria-label={`Note for corner ${index + 1}`}
                  className="h-9 min-w-0 flex-1 text-sm"
                  maxLength={60}
                  placeholder="e.g. gate, outside car park"
                  value={corner.note}
                  onChange={(event) => {
                    const note = event.target.value;
                    setCorners((current) => current.map((item) => (item.id === corner.id ? { ...item, note } : item)));
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove corner ${index + 1}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  onClick={() => setCorners((current) => current.filter((item) => item.id !== corner.id))}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {roadPoints.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span>Road edge: {roadPoints.length} of 2 points</span>
            <button
              type="button"
              aria-label="Remove the road edge"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
              onClick={() => setRoadPoints([])}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-11 gap-2"
            variant="outline"
            onClick={() => (tapMode === 'road' ? setRoadPoints((current) => current.slice(0, -1)) : setCorners((current) => current.slice(0, -1)))}
            disabled={saving || (tapMode === 'road' ? roadPoints.length === 0 : corners.length === 0)}
          >
            <Undo2 className="h-5 w-5" />
            Undo last
          </Button>
          <Button className="h-11 gap-2" variant="outline" onClick={saveCorners} disabled={saving || corners.length < 3}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            Save corners
          </Button>
        </div>

        <section className="space-y-3 rounded-md border border-border p-3" aria-label="Office boundary">
          <div>
            <h3 className="text-sm font-semibold">Office boundary</h3>
            <p className="text-sm text-muted-foreground">
              {boundaries?.active ? `On: ${describeBoundary(boundaries.active)}` : `Today: a circle of ${office?.radiusMeters ?? '—'} m`}
            </p>
          </div>

          {boundaries?.draft && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/10 p-3">
              <p className="text-sm font-medium">Proposed: {describeBoundary(boundaries.draft)}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-10 gap-2" onClick={() => boundaryAction('approve')} disabled={busy !== null}>
                  {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Use this boundary
                </Button>
                <Button className="h-10" variant="outline" onClick={() => boundaryAction('discard')} disabled={busy !== null}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Room for phone error (m)
              <Input type="number" inputMode="numeric" min={0} max={100} className="h-9" value={roomMeters} onChange={(event) => setRoomMeters(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Past the road edge (m)
              <Input type="number" inputMode="numeric" min={0} max={100} className="h-9" value={roadAllowanceMeters} onChange={(event) => setRoadAllowanceMeters(event.target.value)} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="h-10" variant="outline" onClick={() => boundaryAction('propose')} disabled={busy !== null || corners.length < 3}>
              {busy === 'propose' && <Loader2 className="h-4 w-4 animate-spin" />}
              Propose from these corners
            </Button>
            {boundaries?.active && (
              <Button className="h-10" variant="ghost" onClick={() => boundaryAction('remove')} disabled={busy !== null}>
                Back to circle
              </Button>
            )}
          </div>
        </section>

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
