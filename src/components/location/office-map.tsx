'use client';

import '@esri/calcite-components/main.css';
import '@arcgis/map-components/main.css';
import '@arcgis/core/assets/esri/themes/light/view.css';
import type {} from '@arcgis/map-components/types/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { boundaryCircle, boundaryRings, type LatLng, type OfficeBoundary } from '@/lib/office-boundary';
import { cn } from '@/lib/utils';

// The office map is Esri's own map (ArcGIS Maps SDK components): Esri's basemaps and basemap
// gallery, Esri search, zoom, home, my location, full screen, scale and attribution. LateWatch only
// adds the office area on top: the area in force (white) with its pin and backup circle, a proposed
// or edited area (cyan) with the pin and circle it would bring, and while editing the corners and
// road edge to drag. Panels passed as children float over the map (and come along in full screen).

export type MapPoint = LatLng & { id: string };
export type MapCircle = LatLng & { radiusMeters: number };

export type OfficeMapProps = {
  area: OfficeBoundary | null;
  children?: ReactNode;
  corners: MapPoint[];
  editing: boolean;
  fitTo: LatLng[];
  onMessage: (message: string) => void;
  onMovePoint: (kind: 'corner' | 'road', id: string, point: LatLng) => void;
  onRemovePoint: (kind: 'corner' | 'road', id: string) => void;
  onTap: (point: LatLng) => void;
  overlay: OfficeBoundary | null;
  pin: MapCircle | null;
  roadPoints: MapPoint[];
};

type Core = {
  Circle: typeof import('@arcgis/core/geometry/Circle').default;
  Graphic: typeof import('@arcgis/core/Graphic').default;
  GraphicsLayer: typeof import('@arcgis/core/layers/GraphicsLayer').default;
  Multipoint: typeof import('@arcgis/core/geometry/Multipoint').default;
  Point: typeof import('@arcgis/core/geometry/Point').default;
  Polygon: typeof import('@arcgis/core/geometry/Polygon').default;
  Polyline: typeof import('@arcgis/core/geometry/Polyline').default;
  SpatialReference: typeof import('@arcgis/core/geometry/SpatialReference').default;
};
type Layers = { area: InstanceType<Core['GraphicsLayer']>; edit: InstanceType<Core['GraphicsLayer']> };
type Handle = { id: string; kind: 'corner' | 'road'; point: LatLng };

export const MAP_COLORS = { area: '#ffffff', corners: '#22c55e', overlay: '#22d3ee', pin: '#2563eb', road: '#ef4444' };
const ARCGIS_KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY || '';
// Without a key, Esri's public geocoder answers the search.
const PUBLIC_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
// Esri basemaps that need no key.
const BASEMAP_IDS = ['hybrid', 'satellite', 'streets-vector', 'streets-navigation-vector', 'topo-vector', 'gray-vector', 'dark-gray-vector', 'streets-night-vector', 'oceans', 'osm'];
// How close a click or drag must start to a corner to take it: more room for a finger.
const MOUSE_REACH_PX = 14;
const TOUCH_REACH_PX = 22;
const round7 = (value: number) => Math.round(value * 1e7) / 1e7;
const rgba = (hex: string, alpha: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
};

// A numbered corner drawn as a small SVG picture. Esri's text symbols download fonts first, and if
// that fails the whole editing layer stays blank; a picture needs nothing from the network.
function cornerIcon(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">`
    + `<circle cx="20" cy="20" r="17" fill="${MAP_COLORS.pin}" stroke="#ffffff" stroke-width="4"/>`
    + `<text x="20" y="25.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#ffffff">${label}</text>`
    + '</svg>';
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

let esriLoading: Promise<Core> | null = null;

// Esri's components and the few core classes the office overlay needs, loaded in the browser only.
function loadEsri(): Promise<Core> {
  esriLoading ??= (async () => {
    const { default: esriConfig } = await import('@arcgis/core/config');
    if (ARCGIS_KEY) esriConfig.apiKey = ARCGIS_KEY;
    // Never pop up an ArcGIS sign-in box: a service that needs one just fails quietly.
    esriConfig.request.useIdentity = false;
    await Promise.all([
      import('@arcgis/map-components/components/arcgis-map'),
      import('@arcgis/map-components/components/arcgis-search'),
      import('@arcgis/map-components/components/arcgis-zoom'),
      import('@arcgis/map-components/components/arcgis-home'),
      import('@arcgis/map-components/components/arcgis-locate'),
      import('@arcgis/map-components/components/arcgis-fullscreen'),
      import('@arcgis/map-components/components/arcgis-expand'),
      import('@arcgis/map-components/components/arcgis-basemap-gallery'),
      import('@arcgis/map-components/components/arcgis-scale-bar'),
    ]);
    const [Circle, Graphic, GraphicsLayer, Multipoint, Point, Polygon, Polyline, SpatialReference] = await Promise.all([
      import('@arcgis/core/geometry/Circle'),
      import('@arcgis/core/Graphic'),
      import('@arcgis/core/layers/GraphicsLayer'),
      import('@arcgis/core/geometry/Multipoint'),
      import('@arcgis/core/geometry/Point'),
      import('@arcgis/core/geometry/Polygon'),
      import('@arcgis/core/geometry/Polyline'),
      import('@arcgis/core/geometry/SpatialReference'),
    ]);
    return {
      Circle: Circle.default,
      Graphic: Graphic.default,
      GraphicsLayer: GraphicsLayer.default,
      Multipoint: Multipoint.default,
      Point: Point.default,
      Polygon: Polygon.default,
      Polyline: Polyline.default,
      SpatialReference: SpatialReference.default,
    };
  })();
  return esriLoading;
}

export function OfficeMap({
  area, children, corners, editing, fitTo, onMessage, onMovePoint, onRemovePoint, onTap, overlay, pin, roadPoints,
}: OfficeMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLArcgisMapElement>(null);
  const searchRef = useRef<HTMLArcgisSearchElement>(null);
  const galleryRef = useRef<HTMLArcgisBasemapGalleryElement>(null);
  const homeRef = useRef<HTMLArcgisHomeElement>(null);
  const fullscreenRef = useRef<HTMLArcgisFullscreenElement>(null);
  const coreRef = useRef<Core | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const handlesRef = useRef<Handle[]>([]);
  const dragRef = useRef<Handle | null>(null);
  const editingRef = useRef(editing);
  const handlersRef = useRef({ onMessage, onMovePoint, onRemovePoint, onTap });
  const fitRef = useRef(fitTo);
  const [core, setCore] = useState<Core | null>(null);
  const [ready, setReady] = useState(false);
  // The view starts over the office in the basemaps' projection, so the office area still shows if
  // Esri's imagery can't load. Set once: after that the map is the user's to move.
  const [start] = useState(() => (fitTo.length > 0
    ? {
      center: [
        fitTo.reduce((sum, point) => sum + point.longitude, 0) / fitTo.length,
        fitTo.reduce((sum, point) => sum + point.latitude, 0) / fitTo.length,
      ],
      zoom: 17,
    }
    : null));
  const webMercator = useMemo(() => core?.SpatialReference.WebMercator, [core]);

  useEffect(() => {
    handlersRef.current = { onMessage, onMovePoint, onRemovePoint, onTap };
    editingRef.current = editing;
    if (fitTo.length > 0) fitRef.current = fitTo;
  }, [editing, fitTo, onMessage, onMovePoint, onRemovePoint, onTap]);

  useEffect(() => {
    let cancelled = false;
    loadEsri()
      .then((loaded) => {
        if (cancelled) return;
        coreRef.current = loaded;
        setCore(loaded);
      })
      .catch(() => handlersRef.current.onMessage('The Esri map could not load. Check the connection and refresh the page.'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Esri's own controls, set up once the components exist: the search source, the basemaps to
  // choose from, and full screen taking the panels along.
  useEffect(() => {
    if (!core) return;
    let cancelled = false;
    void (async () => {
      const [{ default: Basemap }, { default: LocalBasemapsSource }, { default: LocatorSearchSource }] = await Promise.all([
        import('@arcgis/core/Basemap'),
        import('@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource'),
        import('@arcgis/core/widgets/Search/LocatorSearchSource'),
      ]);
      if (cancelled) return;
      if (galleryRef.current) {
        galleryRef.current.source = new LocalBasemapsSource({
          basemaps: BASEMAP_IDS.map((id) => Basemap.fromId(id)).filter((basemap): basemap is NonNullable<typeof basemap> => Boolean(basemap)),
        });
      }
      if (searchRef.current && !ARCGIS_KEY) {
        searchRef.current.includeDefaultSourcesDisabled = true;
        searchRef.current.sources.removeAll();
        searchRef.current.sources.add(new LocatorSearchSource({
          maxResults: 6,
          maxSuggestions: 6,
          name: 'ArcGIS World Geocoding Service',
          placeholder: 'Search places or addresses',
          singleLineFieldName: 'SingleLine',
          url: PUBLIC_GEOCODER,
        }));
      }
      if (fullscreenRef.current && wrapperRef.current) fullscreenRef.current.element = wrapperRef.current;
    })();
    return () => {
      cancelled = true;
    };
  }, [core]);

  // The view is ready: add LateWatch's layers and frame the office.
  async function onViewReady() {
    const map = mapRef.current;
    const loaded = coreRef.current;
    if (!map?.view || !map.map || !loaded || layersRef.current) return;
    const areaLayer = new loaded.GraphicsLayer({ title: 'Office area' });
    const editLayer = new loaded.GraphicsLayer({ title: 'Editing' });
    map.map.addMany([areaLayer, editLayer]);
    layersRef.current = { area: areaLayer, edit: editLayer };
    const points = fitRef.current;
    if (points.length > 0) {
      const target = new loaded.Multipoint({ points: points.map((point) => [point.longitude, point.latitude]), spatialReference: { wkid: 4326 } });
      await map.goTo({ target }, { animate: false }).catch(() => undefined);
      await map.goTo({ zoom: Math.min(map.zoom, 19) }, { animate: false }).catch(() => undefined);
      if (homeRef.current && map.viewpoint) homeRef.current.viewpoint = map.viewpoint.clone();
    }
    setReady(true);
  }

  // The nearest handle within reach of a screen point (synchronous, so a drag can claim it at once).
  function handleAt(x: number, y: number) {
    const view = mapRef.current?.view;
    const loaded = coreRef.current;
    if (!view || !loaded) return null;
    let nearest: Handle | null = null;
    let best = window.matchMedia('(pointer: coarse)').matches ? TOUCH_REACH_PX : MOUSE_REACH_PX;
    for (const handle of handlesRef.current) {
      const screen = view.toScreen(new loaded.Point({ latitude: handle.point.latitude, longitude: handle.point.longitude }));
      if (!screen) continue;
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance <= best) {
        best = distance;
        nearest = handle;
      }
    }
    return nearest;
  }

  function onViewClick(event: { detail: { mapPoint?: { latitude?: number | null; longitude?: number | null } | null; stopPropagation: () => void; x: number; y: number } }) {
    const { mapPoint, x, y } = event.detail;
    if (mapPoint?.latitude == null || mapPoint.longitude == null) return;
    // The click is handled here: Esri's own popup handling would close the popup again, finding no
    // features to show.
    event.detail.stopPropagation();
    const point = { latitude: round7(mapPoint.latitude), longitude: round7(mapPoint.longitude) };
    if (editingRef.current) {
      const handle = handleAt(x, y);
      if (handle) handlersRef.current.onRemovePoint(handle.kind, handle.id);
      else handlersRef.current.onTap(point);
      return;
    }
    // Outside editing a click shows where it is, like any map.
    void mapRef.current?.openPopup({
      content: `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`,
      location: mapRef.current.toMap({ x, y }) ?? undefined,
      title: 'This spot',
    });
  }

  function onViewDrag(event: { detail: { action: string; stopPropagation: () => void; x: number; y: number } }) {
    if (!editingRef.current) return;
    const { action, x, y } = event.detail;
    if (action === 'start') dragRef.current = handleAt(x, y);
    const dragging = dragRef.current;
    if (!dragging) return;
    // A handle is being dragged: the map stays still.
    event.detail.stopPropagation();
    const mapPoint = mapRef.current?.toMap({ x, y });
    if (mapPoint?.latitude == null || mapPoint.longitude == null) return;
    const point = { latitude: round7(mapPoint.latitude), longitude: round7(mapPoint.longitude) };
    if (action === 'update') {
      const graphics = layersRef.current?.edit.graphics.filter((graphic) => graphic.attributes?.handleId === dragging.id);
      graphics?.forEach((graphic) => {
        graphic.geometry = mapPoint.clone();
      });
    }
    if (action === 'end') {
      dragRef.current = null;
      handlersRef.current.onMovePoint(dragging.kind, dragging.id, point);
    }
  }

  // What is in force, and a proposed or edited area with the pin and circle it would bring.
  useEffect(() => {
    const layer = layersRef.current?.area;
    if (!ready || !core || !layer) return;
    layer.removeAll();
    const wgs84 = { wkid: 4326 };
    const dim = editing || Boolean(overlay) ? 0.45 : 1;
    const drawArea = (boundary: OfficeBoundary, color: string, opacity: number) => {
      layer.add(new core.Graphic({
        geometry: new core.Polygon({ rings: [boundary.outline.map((point) => [point.longitude, point.latitude])], spatialReference: wgs84 }),
        symbol: { color: rgba(color, 0.06 * opacity), outline: { color: rgba(color, opacity), width: 1 }, type: 'simple-fill' },
      }));
      layer.add(new core.Graphic({
        geometry: new core.Polyline({ paths: boundaryRings(boundary).map((ring) => ring.map((point) => [point.longitude, point.latitude])), spatialReference: wgs84 }),
        symbol: { color: rgba(color, opacity), type: 'simple-line', width: 2.5 },
      }));
      if (boundary.road) {
        layer.add(new core.Graphic({
          geometry: new core.Polyline({ paths: [[[boundary.road.from.longitude, boundary.road.from.latitude], [boundary.road.to.longitude, boundary.road.to.latitude]]], spatialReference: wgs84 }),
          symbol: { color: rgba(MAP_COLORS.road, opacity), type: 'simple-line', width: 2 },
        }));
      }
    };
    const drawPin = (circle: MapCircle, color: string, opacity: number, width: number) => {
      layer.add(new core.Graphic({
        geometry: new core.Circle({ center: new core.Point({ latitude: circle.latitude, longitude: circle.longitude }), geodesic: true, numberOfPoints: 120, radius: circle.radiusMeters, radiusUnit: 'meters' }),
        symbol: { color: [0, 0, 0, 0], outline: { color: rgba(color, opacity), style: 'dash', width }, type: 'simple-fill' },
      }));
      layer.add(new core.Graphic({
        geometry: new core.Point({ latitude: circle.latitude, longitude: circle.longitude }),
        symbol: { color: rgba(color === MAP_COLORS.area ? MAP_COLORS.pin : color, opacity), outline: { color: [255, 255, 255, opacity], width: 1.5 }, size: 9, type: 'simple-marker' },
      }));
    };
    if (area) drawArea(area, MAP_COLORS.area, dim);
    // With an area on, the circle is only its backup: drawn faint. Without one, it is the rule.
    if (pin) drawPin(pin, MAP_COLORS.area, area ? 0.45 * dim : dim, area ? 1 : 1.5);
    if (overlay) {
      drawArea(overlay, MAP_COLORS.overlay, 1);
      drawPin(boundaryCircle(overlay), MAP_COLORS.overlay, 0.75, 1);
    }
  }, [area, core, editing, overlay, pin, ready]);

  // While editing: numbered corners and the road edge. Drag to move; click to remove.
  useEffect(() => {
    const layer = layersRef.current?.edit;
    if (!ready || !core || !layer) return;
    layer.removeAll();
    handlesRef.current = [];
    if (!editing) return;
    mapRef.current?.closePopup();
    const wgs84 = { wkid: 4326 };
    if (corners.length >= 2) {
      const line = corners.map((corner) => [corner.longitude, corner.latitude]);
      layer.add(new core.Graphic({
        geometry: new core.Polyline({ paths: [corners.length >= 3 ? [...line, line[0]] : line], spatialReference: wgs84 }),
        symbol: { color: rgba(MAP_COLORS.corners, 1), type: 'simple-line', width: 2 },
      }));
    }
    if (roadPoints.length === 2) {
      layer.add(new core.Graphic({
        geometry: new core.Polyline({ paths: [roadPoints.map((point) => [point.longitude, point.latitude])], spatialReference: wgs84 }),
        symbol: { color: rgba(MAP_COLORS.road, 1), style: 'dash', type: 'simple-line', width: 2.5 },
      }));
    }
    corners.forEach((corner, index) => {
      layer.add(new core.Graphic({
        attributes: { handleId: corner.id },
        geometry: new core.Point({ latitude: corner.latitude, longitude: corner.longitude }),
        symbol: { height: 20, type: 'picture-marker', url: cornerIcon(String(index + 1)), width: 20 },
      }));
      handlesRef.current.push({ id: corner.id, kind: 'corner', point: corner });
    });
    roadPoints.forEach((point) => {
      layer.add(new core.Graphic({
        attributes: { handleId: point.id },
        geometry: new core.Point({ latitude: point.latitude, longitude: point.longitude }),
        symbol: { color: rgba(MAP_COLORS.road, 1), outline: { color: [255, 255, 255, 1], width: 2 }, size: 13, style: 'square', type: 'simple-marker' },
      }));
      handlesRef.current.push({ id: point.id, kind: 'road', point });
    });
  }, [core, corners, editing, ready, roadPoints]);

  return (
    // isolate: the map's own layers stay under the page's menus and popups.
    <div ref={wrapperRef} className={cn('relative isolate h-full w-full overflow-hidden bg-muted', editing && '[&_.esri-view-surface]:cursor-crosshair')}>
      {core ? (
        <arcgis-map
          ref={mapRef}
          aria-label="Map of the office grounds"
          basemap="hybrid"
          center={start?.center}
          className="absolute inset-0 block"
          spatialReference={webMercator}
          zoom={start?.zoom}
          onarcgisViewClick={onViewClick}
          onarcgisViewDrag={onViewDrag}
          onarcgisViewReadyChange={() => void onViewReady()}
        >
          <arcgis-search ref={searchRef} slot="top-right" />
          <arcgis-zoom slot="top-right" />
          <arcgis-home ref={homeRef} slot="top-right" />
          <arcgis-locate slot="top-right" />
          <arcgis-fullscreen ref={fullscreenRef} slot="top-right" />
          <arcgis-expand slot="top-right" expandTooltip="Basemaps">
            <arcgis-basemap-gallery ref={galleryRef} />
          </arcgis-expand>
          <arcgis-scale-bar slot="bottom-left" unit="metric" />
        </arcgis-map>
      ) : null}
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading map…
        </div>
      )}
      {children}
    </div>
  );
}
