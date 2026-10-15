'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2 } from 'lucide-react';
import { boundaryContour, type LatLng, type OfficeBoundary } from '@/lib/office-boundary';

// The office on Esri satellite imagery: the sign-in area in force (the office boundary in white,
// or the circle dashed), a proposed boundary in cyan, and the corners being drawn. Clicks and
// drags are handed to the page; the map keeps no state of its own.

export type MapPoint = LatLng & { id: string };
export type MapTapMode = 'corner' | 'road' | 'pin';

type Props = {
  active: OfficeBoundary | null;
  ariaLabel?: string;
  corners: MapPoint[];
  draft: OfficeBoundary | null;
  onMovePoint: (kind: 'corner' | 'road', id: string, point: LatLng) => void;
  onTap: (point: LatLng) => void;
  pin: (LatLng & { radiusMeters: number }) | null;
  pinDraft: LatLng | null;
  roadPoints: MapPoint[];
};

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Powered by Esri | Maxar, Earthstar Geographics';
export const MAP_COLORS = { active: '#ffffff', corners: '#22c55e', draft: '#22d3ee', pinDraft: '#f97316', road: '#ef4444' };
const CORNER_ICON_CLASS = 'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-md';
const ROAD_ICON_CLASS = 'block h-5 w-5 rounded-sm border-2 border-white bg-danger shadow-md';
const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const toLatLng = (point: LatLng) => [point.latitude, point.longitude] as [number, number];

export function OfficeMap({ active, ariaLabel, corners, draft, onMovePoint, onTap, pin, pinDraft, roadPoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const areaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const drawingLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const handlersRef = useRef({ onMovePoint, onTap });
  const [ready, setReady] = useState(false);
  const center = pin ? toLatLng(pin) : null;

  useEffect(() => {
    handlersRef.current = { onMovePoint, onTap };
  }, [onMovePoint, onTap]);

  // Created once the office pin is known, so it opens on the office.
  const hasCenter = Boolean(center);
  useEffect(() => {
    if (!hasCenter || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current || !center) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current).setView(center, 18);
      map.attributionControl.setPrefix(false);
      L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 19, maxZoom: 21 }).addTo(map);
      areaLayerRef.current = L.layerGroup().addTo(map);
      drawingLayerRef.current = L.layerGroup().addTo(map);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        handlersRef.current.onTap({ latitude: round7(event.latlng.lat), longitude: round7(event.latlng.lng) });
      });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // The centre only matters for the first view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCenter]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  // The sign-in area in force, and a proposed boundary waiting for approval.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = areaLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (pin) {
      if (!active) {
        L.circle(toLatLng(pin), {
          color: MAP_COLORS.active, dashArray: '6 6', fill: false, interactive: false, radius: pin.radiusMeters, weight: 2,
        }).addTo(layer);
      }
      L.circleMarker(toLatLng(pin), {
        color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1, interactive: false, radius: 5, weight: 2,
      }).addTo(layer);
    }
    const draw = (boundary: OfficeBoundary, color: string) => {
      L.polygon(boundary.outline.map(toLatLng), { color, fillOpacity: 0.08, interactive: false, weight: 1 }).addTo(layer);
      const segments = boundaryContour(boundary).map(([a, b]) => [toLatLng(a), toLatLng(b)]);
      L.polyline(segments, { color, interactive: false, weight: 3 }).addTo(layer);
      if (boundary.road) {
        L.polyline([toLatLng(boundary.road.from), toLatLng(boundary.road.to)], { color: MAP_COLORS.road, interactive: false, weight: 2 }).addTo(layer);
      }
    };
    if (active) draw(active, MAP_COLORS.active);
    if (draft) draw(draft, MAP_COLORS.draft);
  }, [active, draft, pin, ready]);

  // What is being drawn: numbered corners (drag to adjust), the road edge and a new pin.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = drawingLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const points = corners.map(toLatLng);
    if (points.length >= 3) L.polygon(points, { color: MAP_COLORS.corners, fillOpacity: 0.15, interactive: false, weight: 2 }).addTo(layer);
    if (points.length === 2) L.polyline(points, { color: MAP_COLORS.corners, interactive: false, weight: 2 }).addTo(layer);
    if (roadPoints.length === 2) {
      L.polyline(roadPoints.map(toLatLng), { color: MAP_COLORS.road, dashArray: '4 4', interactive: false, weight: 3 }).addTo(layer);
    }
    const addPin = (kind: 'corner' | 'road', point: MapPoint, html: string, size: number) => {
      const marker = L.marker(toLatLng(point), {
        draggable: true,
        icon: L.divIcon({ className: '', html, iconAnchor: [size / 2, size / 2], iconSize: [size, size] }),
        keyboard: false,
      });
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        handlersRef.current.onMovePoint(kind, point.id, { latitude: round7(position.lat), longitude: round7(position.lng) });
      });
      marker.addTo(layer);
    };
    corners.forEach((corner, index) => addPin('corner', corner, `<span class="${CORNER_ICON_CLASS}">${index + 1}</span>`, 28));
    roadPoints.forEach((point) => addPin('road', point, `<span class="${ROAD_ICON_CLASS}"></span>`, 20));
    if (pinDraft) {
      L.circleMarker(toLatLng(pinDraft), {
        color: '#ffffff', fillColor: MAP_COLORS.pinDraft, fillOpacity: 1, interactive: false, radius: 7, weight: 2,
      }).addTo(layer);
    }
  }, [corners, pinDraft, ready, roadPoints]);

  return (
    <div className="relative h-full min-h-80 w-full overflow-hidden rounded-md border border-border bg-muted">
      <div ref={containerRef} role="application" aria-label={ariaLabel || 'Satellite map of the office'} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading map…
        </div>
      )}
    </div>
  );
}
