'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2 } from 'lucide-react';
import { boundaryCircle, boundaryContour, type LatLng, type OfficeBoundary } from '@/lib/office-boundary';
import { cn } from '@/lib/utils';

// A full map of the office on Esri imagery: map types (satellite, satellite with labels, streets),
// zoom, back to the office, my location, full screen and a scale. It draws the sign-in area in
// force (white) with its pin and backup circle, a proposed or edited area (cyan) with the pin and
// circle it would bring, a searched place, and while editing the corners and road edge to drag.
// Panels passed as children float over the map (and come along in full screen).

export type MapPoint = LatLng & { id: string };
export type MapFocus = LatLng & { key: number; label: string };
type Circle = LatLng & { radiusMeters: number };

type Props = {
  area: OfficeBoundary | null;
  children?: ReactNode;
  corners: MapPoint[];
  editing: boolean;
  fitTo: LatLng[];
  focus: MapFocus | null;
  onMessage: (message: string) => void;
  onMovePoint: (kind: 'corner' | 'road', id: string, point: LatLng) => void;
  onRemovePoint: (kind: 'corner' | 'road', id: string) => void;
  onTap: (point: LatLng) => void;
  overlay: OfficeBoundary | null;
  pin: Circle | null;
  roadPoints: MapPoint[];
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const TILES = {
  imagery: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  places: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
  streets: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
  transport: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
};
const IMAGERY_CREDIT = 'Powered by Esri | Maxar, Earthstar Geographics';
const STREETS_CREDIT = 'Powered by Esri | Esri, HERE, Garmin, OpenStreetMap contributors';
export const MAP_COLORS = { area: '#ffffff', corners: '#22c55e', overlay: '#22d3ee', pin: '#2563eb', road: '#ef4444' };
const CORNER_ICON_CLASS = 'flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary text-[11px] font-bold text-primary-foreground shadow-md';
const ROAD_ICON_CLASS = 'block h-4 w-4 rounded-sm border-2 border-white bg-danger shadow-md';
const FOCUS_ICON = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 36 14 36s14-11.7 14-22.1C28 6.2 21.7 0 14 0z" fill="#ef4444" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg>';
const ICONS = {
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
};
const icon = (paths: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const toLatLng = (point: LatLng) => [point.latitude, point.longitude] as [number, number];

export function OfficeMap({
  area, children, corners, editing, fitTo, focus, onMessage, onMovePoint, onRemovePoint, onTap, overlay, pin, roadPoints,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const areaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const editLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const extraLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const homeRef = useRef<LatLng[]>(fitTo);
  const editingRef = useRef(editing);
  const handlersRef = useRef({ onMessage, onMovePoint, onRemovePoint, onTap });
  const [ready, setReady] = useState(false);
  const hasView = fitTo.length > 0;

  useEffect(() => {
    handlersRef.current = { onMessage, onMovePoint, onRemovePoint, onTap };
    editingRef.current = editing;
    if (fitTo.length > 0) homeRef.current = fitTo;
  }, [editing, fitTo, onMessage, onMovePoint, onRemovePoint, onTap]);

  // Created once there is something to show, framed on it. (Leaflet owns the container's classes:
  // React never changes them, or the map loses its styling.)
  useEffect(() => {
    if (!hasView || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: false, zoomDelta: 0.5, zoomSnap: 0.25 });
      const frameHome = () => map.fitBounds(L.latLngBounds(homeRef.current.map(toLatLng)), { maxZoom: 19, padding: [40, 40] });
      frameHome();
      map.attributionControl.setPrefix(false);

      const tiles = (url: string, attribution?: string) => L.tileLayer(url, { attribution, maxNativeZoom: 19, maxZoom: 21 });
      const baseLayers = {
        'Satellite with labels': L.layerGroup([tiles(TILES.imagery, IMAGERY_CREDIT), tiles(TILES.transport), tiles(TILES.places)]),
        Satellite: tiles(TILES.imagery, IMAGERY_CREDIT),
        Streets: tiles(TILES.streets, STREETS_CREDIT),
      };
      baseLayers['Satellite with labels'].addTo(map);
      L.control.layers(baseLayers, undefined, { position: 'topright' }).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);

      // Back to the office, my location and full screen, as map buttons.
      const Tools = L.Control.extend({
        onAdd() {
          const bar = L.DomUtil.create('div', 'leaflet-bar');
          const add = (label: string, paths: string, onClick: (button: HTMLAnchorElement) => void) => {
            const button = L.DomUtil.create('a', '', bar) as HTMLAnchorElement;
            button.href = '#';
            button.title = label;
            button.setAttribute('role', 'button');
            button.setAttribute('aria-label', label);
            button.style.display = 'flex';
            button.style.alignItems = 'center';
            button.style.justifyContent = 'center';
            button.innerHTML = icon(paths);
            L.DomEvent.on(button, 'click', (event) => {
              L.DomEvent.preventDefault(event);
              onClick(button);
            });
          };
          add('Show the office', ICONS.home, frameHome);
          add('Show my location', ICONS.locate, () => map.locate({ enableHighAccuracy: true, maxZoom: 19, setView: true, timeout: 20_000 }));
          add('Full screen', ICONS.expand, (button) => {
            const wrapper = wrapperRef.current;
            if (!wrapper) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else if (wrapper.requestFullscreen) void wrapper.requestFullscreen().catch(() => handlersRef.current.onMessage('Full screen is not available in this browser.'));
            const update = () => {
              const full = Boolean(document.fullscreenElement);
              button.innerHTML = icon(full ? ICONS.shrink : ICONS.expand);
              button.title = full ? 'Leave full screen' : 'Full screen';
              if (!full) document.removeEventListener('fullscreenchange', update);
            };
            document.addEventListener('fullscreenchange', update);
          });
          L.DomEvent.disableClickPropagation(bar);
          return bar;
        },
      });
      new Tools({ position: 'topright' }).addTo(map);
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

      areaLayerRef.current = L.layerGroup().addTo(map);
      extraLayerRef.current = L.layerGroup().addTo(map);
      editLayerRef.current = L.layerGroup().addTo(map);
      const located = L.layerGroup().addTo(map);
      map.on('locationfound', (event: Leaflet.LocationEvent) => {
        located.clearLayers();
        L.circle(event.latlng, { color: MAP_COLORS.pin, fillOpacity: 0.12, interactive: false, radius: event.accuracy, weight: 1 }).addTo(located);
        L.circleMarker(event.latlng, { color: '#ffffff', fillColor: MAP_COLORS.pin, fillOpacity: 1, interactive: false, radius: 7, weight: 3 }).addTo(located);
      });
      map.on('locationerror', () => handlersRef.current.onMessage('Your location is not available. Allow location for this site and try again.'));
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        const point = { latitude: round7(event.latlng.lat), longitude: round7(event.latlng.lng) };
        if (editingRef.current) {
          handlersRef.current.onTap(point);
          return;
        }
        // Outside editing a click shows where it is, like any map.
        L.popup({ closeButton: false }).setLatLng(event.latlng).setContent(`<span style="font-family:ui-monospace,monospace">${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}</span>`).openOn(map);
      });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasView]);

  // The layout (and full screen) can change the map's size: redraw to fit.
  useEffect(() => {
    const container = containerRef.current;
    if (!ready || !container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  // What is in force, and a proposed or edited area with the pin and circle it would bring.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = areaLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const dim = editing || Boolean(overlay) ? 0.45 : 1;
    const drawArea = (boundary: OfficeBoundary, color: string, opacity: number) => {
      L.polygon(boundary.outline.map(toLatLng), { color, fillOpacity: 0.06 * opacity, interactive: false, opacity, weight: 1 }).addTo(layer);
      L.polyline(boundaryContour(boundary).map(([a, b]) => [toLatLng(a), toLatLng(b)]), { color, interactive: false, opacity, weight: 3 }).addTo(layer);
      if (boundary.road) {
        L.polyline([toLatLng(boundary.road.from), toLatLng(boundary.road.to)], { color: MAP_COLORS.road, interactive: false, opacity, weight: 2 }).addTo(layer);
      }
    };
    const drawPin = (circle: Circle, color: string, opacity: number, circleWeight: number) => {
      L.circle(toLatLng(circle), {
        color, dashArray: '6 6', fill: false, interactive: false, opacity, radius: circle.radiusMeters, weight: circleWeight,
      }).addTo(layer);
      L.circleMarker(toLatLng(circle), {
        color: '#ffffff', fillColor: color === MAP_COLORS.area ? MAP_COLORS.pin : color, fillOpacity: opacity, interactive: false, opacity, radius: 5, weight: 2,
      }).addTo(layer);
    };

    if (area) drawArea(area, MAP_COLORS.area, dim);
    // With an area on, the circle is only its backup: drawn faint. Without one, it is the rule.
    if (pin) drawPin(pin, MAP_COLORS.area, area ? 0.45 * dim : dim, area ? 1 : 2);
    if (overlay) {
      drawArea(overlay, MAP_COLORS.overlay, 1);
      drawPin(boundaryCircle(overlay), MAP_COLORS.overlay, 0.75, 1);
    }
  }, [area, editing, overlay, pin, ready]);

  // A searched place: fly there and mark it.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = extraLayerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();
    if (!focus) return;
    L.marker(toLatLng(focus), {
      icon: L.divIcon({ className: '', html: FOCUS_ICON, iconAnchor: [14, 36], iconSize: [28, 36], tooltipAnchor: [0, -32] }),
      interactive: false,
      keyboard: false,
    }).bindTooltip(focus.label, { direction: 'top', permanent: true }).addTo(layer);
    map.flyTo(toLatLng(focus), Math.max(map.getZoom(), 17), { duration: 0.8 });
  }, [focus, ready]);

  // While editing: numbered corners and the road edge. Drag to move; click to remove.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = editLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!editing) return;
    mapRef.current?.closePopup();
    if (corners.length >= 2) {
      const line = corners.map(toLatLng);
      (corners.length >= 3
        ? L.polygon(line, { color: MAP_COLORS.corners, fill: false, interactive: false, weight: 2 })
        : L.polyline(line, { color: MAP_COLORS.corners, interactive: false, weight: 2 })).addTo(layer);
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
    // isolate: the map's own layers stay under the page's menus and popups.
    <div ref={wrapperRef} className={cn('relative isolate h-full w-full overflow-hidden bg-muted', editing && '[&_.leaflet-container]:cursor-crosshair')}>
      <div ref={containerRef} role="application" aria-label="Satellite map of the office grounds" className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading map…
        </div>
      )}
      {children}
    </div>
  );
}
