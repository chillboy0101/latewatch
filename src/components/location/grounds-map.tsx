'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2, Map as MapIcon, Save, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// The office grounds on Esri satellite imagery. Tap the map at each corner of the wall and the car
// parks (drag a number to adjust it). Saving keeps the corners in the audit trail for working out
// the office boundary; it does not change the office location.

type Office = { latitude: number; longitude: number; radiusMeters: number } | null;
type MapCorner = { id: string; latitude: number; longitude: number; note: string };
type TrailReading = { accuracy: number; latitude: number; longitude: number; note: string | null };

const STORAGE_KEY = 'latewatch.map-corners.v1';
const MAX_CORNERS = 60;
const TRAIL_MAX_ACCURACY_METERS = 30;
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Powered by Esri | Maxar, Earthstar Geographics';
const CORNER_ICON_CLASS = 'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-md';

const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function readStoredCorners(): MapCorner[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((corner) => Number.isFinite(corner?.latitude) && Number.isFinite(corner?.longitude)) : [];
  } catch {
    return [];
  }
}

export function GroundsMapCard({ office }: { office: Office }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const cornerLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState(false);
  const [corners, setCorners] = useState<MapCorner[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Corners survive a reload (kept on this phone only until saved).
  useEffect(() => {
    setCorners(readStoredCorners());
    setStored(true);
  }, []);
  useEffect(() => {
    if (!stored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(corners));
    } catch {
      // Storage blocked: the corners stay on screen for this visit.
    }
  }, [corners, stored]);

  // The map itself, once the office is known: imagery, today's circle (dashed) and the walk shared today.
  useEffect(() => {
    if (!office || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current).setView([office.latitude, office.longitude], 18);
      map.attributionControl.setPrefix(false);
      L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 19, maxZoom: 21 }).addTo(map);
      L.circle([office.latitude, office.longitude], {
        color: '#ffffff', dashArray: '6 6', fill: false, interactive: false, radius: office.radiusMeters, weight: 2,
      }).addTo(map);
      L.circleMarker([office.latitude, office.longitude], {
        color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1, interactive: false, radius: 5, weight: 2,
      }).addTo(map);
      cornerLayerRef.current = L.layerGroup().addTo(map);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        setNotice('');
        setCorners((current) => (current.length >= MAX_CORNERS
          ? current
          : [...current, { id: newId(), latitude: round7(event.latlng.lat), longitude: round7(event.latlng.lng), note: '' }]));
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
          if (path.length > 1) L.polyline(path, { color: '#facc15', interactive: false, opacity: 0.85, weight: 2 }).addTo(map);
          for (const reading of readings) {
            if (!reading.note) continue;
            L.circleMarker([reading.latitude, reading.longitude], { color: '#facc15', fillOpacity: 1, radius: 4, weight: 2 })
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

  // Corners as numbered pins (drag to adjust) joined into the grounds outline.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = cornerLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const points = corners.map((corner) => [corner.latitude, corner.longitude] as [number, number]);
    if (points.length >= 3) L.polygon(points, { color: '#22c55e', fillOpacity: 0.15, interactive: false, weight: 2 }).addTo(layer);
    if (points.length === 2) L.polyline(points, { color: '#22c55e', interactive: false, weight: 2 }).addTo(layer);
    corners.forEach((corner, index) => {
      const marker = L.marker([corner.latitude, corner.longitude], {
        draggable: true,
        icon: L.divIcon({ className: '', html: `<span class="${CORNER_ICON_CLASS}">${index + 1}</span>`, iconAnchor: [14, 14], iconSize: [28, 28] }),
        keyboard: false,
      });
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        setCorners((current) => current.map((item) => (item.id === corner.id
          ? { ...item, latitude: round7(position.lat), longitude: round7(position.lng) }
          : item)));
      });
      marker.addTo(layer);
    });
  }, [corners, ready]);

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

  function clearCorners() {
    if (!window.confirm('Remove all corners placed on the map?')) return;
    setCorners([]);
    setNotice('');
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MapIcon className="h-5 w-5 text-primary" />
          Mark corners on the map
        </h2>
        {corners.length > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearCorners}>Clear</Button>
        )}
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          Tap the map at each corner of the wall and the car parks, going round in order. Drag a number to adjust it.
        </p>
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
        <p className="text-xs text-muted-foreground">Dashed: today&apos;s office circle · yellow: your shared walk</p>

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

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-11 gap-2"
            variant="outline"
            onClick={() => setCorners((current) => current.slice(0, -1))}
            disabled={saving || corners.length === 0}
          >
            <Undo2 className="h-5 w-5" />
            Undo last
          </Button>
          <Button className="h-11 gap-2" onClick={saveCorners} disabled={saving || corners.length < 3}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            Save corners
          </Button>
        </div>

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
