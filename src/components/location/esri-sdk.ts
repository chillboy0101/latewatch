// Esri's map library for the Office Location map: Esri's map, search, basemap gallery and other
// tools, and the classes the office overlay uses. scripts/build-esri.mjs bundles this file on its
// own into public/esri (before `next build` and `next dev`), and office-map.tsx loads that bundle in
// the browser, so the app's own build never has to bundle the SDK. Nothing imports this at runtime.
import '@esri/calcite-components/main.css';
import '@arcgis/map-components/main.css';
import '@arcgis/core/assets/esri/themes/light/view.css';
import '@arcgis/map-components/components/arcgis-map';
import '@arcgis/map-components/components/arcgis-search';
import '@arcgis/map-components/components/arcgis-zoom';
import '@arcgis/map-components/components/arcgis-home';
import '@arcgis/map-components/components/arcgis-locate';
import '@arcgis/map-components/components/arcgis-fullscreen';
import '@arcgis/map-components/components/arcgis-expand';
import '@arcgis/map-components/components/arcgis-basemap-gallery';
import '@arcgis/map-components/components/arcgis-scale-bar';

export { default as Basemap } from '@arcgis/core/Basemap';
export { default as esriConfig } from '@arcgis/core/config';
export { default as Graphic } from '@arcgis/core/Graphic';
export { default as Circle } from '@arcgis/core/geometry/Circle';
export { default as Multipoint } from '@arcgis/core/geometry/Multipoint';
export { default as Point } from '@arcgis/core/geometry/Point';
export { default as Polygon } from '@arcgis/core/geometry/Polygon';
export { default as Polyline } from '@arcgis/core/geometry/Polyline';
export { default as SpatialReference } from '@arcgis/core/geometry/SpatialReference';
export { default as GraphicsLayer } from '@arcgis/core/layers/GraphicsLayer';
export { default as LocalBasemapsSource } from '@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource';
export { default as LocatorSearchSource } from '@arcgis/core/widgets/Search/LocatorSearchSource';
