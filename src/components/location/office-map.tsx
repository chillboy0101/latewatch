'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2 } from 'lucide-react';
import { boundaryContour, type LatLng, type OfficeBoundary } from '@/lib/office-boundary';

// The office on Esri satellite imagery: the sign-in area in force (white), a proposed or edited
// area (cyan), and, while editing, the corners and road edge to drag. Clicks and drags go to the
// page; the map keeps no state of its own.

export type MapPoint = LatLng & { id: string };

type Props = {
  area: OfficeBoundary | null;
  circle: (LatLng & { radiusMeters: number }) | null;
  corners: MapPoint[];
  editing: boolean;
  fitTo: LatLng[];
  onMovePoint: (kind: 'corner' | 'road', id: string, point: LatLng) => void;
  onRemovePoint: (kind: 'corner' | 'road', id: string) => void;
  onTap: (point: LatLng) => void;
  overlay: OfficeBoundary | null;
  roadPoints: MapPoint[];
};

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Powered by Esri | Maxar, Earthstar Geographics';
export const MAP_COLORS = { area: '#ffffff', corners: '#22c55e', overlay: '#22d3ee', road: '#ef4444' };
const CORNER_ICON_CLASS = 'flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary text-[11px] font-bold text-primary-foreground shadow-md';
const ROAD_ICON_CLASS = 'block h-4 w-4 rounded-sm border-2 border-white bg-danger shadow-md';
const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const toLatLng = (point: LatLng) => [point.latitude, point.longitude] as [number, number];

export function OfficeMap({ area, circle, corners, editing, fitTo, onMovePoint, onRemovePoint, onTap, overlay, roadPoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const areaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const editLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const handlersRef = useRef({ onMovePoint, onRemovePoint, onTap });
  const [ready, setReady] = useState(false);
  const hasView = fitTo.length > 0;

  useEffect(() => {
    handlersRef.current = { onMovePoint, onRemovePoint, onTap };
  }, [onMovePoint, onRemovePoint, onTap]);

  // Created once there is something to show, framed on it.
  useEffect(() => {
    if (!hasView || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    const frame = fitTo;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomDelta: 0.5, zoomSnap: 0.25 });
      map.fitBounds(L.latLngBounds(frame.map(toLatLng)), { maxZoom: 19, padding: [32, 32] });
      map.attributionControl.setPrefix(false);
      L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 19, maxZoom: 21 }).addTo(map);
      areaLayerRef.current = L.layerGroup().addTo(map);
      editLayerRef.current = L.layerGroup().addTo(map);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        handlersRef.current.onTap({ latitude: round7(event.latlng.lat), longitude: round7(event.latlng.lng) });
      });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // Framed once, on the first thing there is to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasView]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  // The area in force (or the circle when there is none) and a proposed or edited area.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = areaLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const draw = (boundary: OfficeBoundary, color: string, weight: number) => {
      L.polygon(boundary.outline.map(toLatLng), { color, fillOpacity: 0.06, interactive: false, weight: 1 }).addTo(layer);
      L.polyline(boundaryContour(boundary).map(([a, b]) => [toLatLng(a), toLatLng(b)]), { color, interactive: false, weight }).addTo(layer);
      if (boundary.road) {
        L.polyline([toLatLng(boundary.road.from), toLatLng(boundary.road.to)], { color: MAP_COLORS.road, interactive: false, weight: 2 }).addTo(layer);
      }
    };
    if (area && !editing) draw(area, MAP_COLORS.area, 3);
    if (!area && circle && !editing) {
      L.circle(toLatLng(circle), { color: MAP_COLORS.area, dashArray: '6 6', fill: false, interactive: false, radius: circle.radiusMeters, weight: 2 }).addTo(layer);
    }
    if (overlay) draw(overlay, MAP_COLORS.overlay, 3);
  }, [area, circle, editing, overlay, ready]);

  // While editing: numbered corners and the road edge. Drag to move; click to remove.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = editLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!editing) return;
    if (corners.length >= 2) {
      const line = corners.map(toLatLng);
      (corners.length >= 3 ? L.polygon(line, { color: MAP_COLORS.corners, fill: false, interactive: false, weight: 2 }) : L.polyline(line, { color: MAP_COLORS.corners, interactive: false, weight: 2 })).addTo(layer);
    }
    if (roadPoints.length === 2) {
      L.polyline(roadPoints.map(toLatLng), { color: MAP_COLORS.road, dashArray: '4 4', interactive: false, weight: 3 }).addTo(layer);
    }
    const addHandle = (kind: 'corner' | 'road', point: MapPoint, html: string, size: number, title: string) => {
      const marker = L.marker(toLatLng(point), {
        draggable: true,
        icon: L.divIcon({ className: '', html, iconAnchor: [size / 2, size / 2], iconSize: [size, size] }),
        keyboard: false,
        title,
      });
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        handlersRef.current.onMovePoint(kind, point.id, { latitude: round7(position.lat), longitude: round7(position.lng) });
      });
      marker.on('click', () => handlersRef.current.onRemovePoint(kind, point.id));
      marker.addTo(layer);
    };
    corners.forEach((corner, index) => addHandle('corner', corner, `<span class="${CORNER_ICON_CLASS}">${index + 1}</span>`, 24, `Corner ${index + 1}: drag to move, click to remove`));
    roadPoints.forEach((point) => addHandle('road', point, `<span class="${ROAD_ICON_CLASS}"></span>`, 16, 'Road edge: drag to move, click to remove'));
  }, [corners, editing, ready, roadPoints]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted">
      <div ref={containerRef} role="application" aria-label="Satellite map of the office grounds" className={editing ? 'h-full w-full cursor-crosshair' : 'h-full w-full'} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading map…
        </div>
      )}
    </div>
  );
}
