/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('corners tapped on the Esri satellite map are saved as map corners, office unchanged', () => {
  const map = read('src', 'components', 'location', 'grounds-map.tsx');
  assert.match(map, /'https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}'/);
  assert.match(map, /attribution: ESRI_ATTRIBUTION/);
  assert.match(map, /void import\('leaflet'\)/);
  assert.match(map, /map\.on\('click'/);
  assert.match(map, /marker\.on\('dragend'/);
  assert.match(map, /source: 'map',/);
  assert.match(map, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(corners\)\)/);

  const route = read('src', 'app', 'api', 'attendance', 'location', 'measurements', 'route.ts');
  assert.match(route, /const source = body\?\.source === 'map' \? 'map' : 'walk';/);
  assert.match(route, /rawPoints\.map\(source === 'map' \? parseMapPoint : parsePoint\)/);
  assert.match(route, /entityType: 'office_grounds_measurement'/);
  assert.doesNotMatch(route, /officeLocation/);
});

test('the map shows only this admin\'s own shared walk', () => {
  const route = read('src', 'app', 'api', 'attendance', 'location', 'trace', 'route.ts');
  assert.equal(route.match(/const authError = await enforceRole\(\['admin'\]\);/g).length, 2);
  assert.match(route, /\.where\(and\(eq\(locationTrace\.userId, userId\), gt\(locationTrace\.capturedAt, new Date\(Date\.now\(\) - KEEP_MS\)\)\)\)/);
  const page = read('src', 'app', 'location', 'measure', 'page.tsx');
  assert.match(page, /<GroundsMapCard office=\{office\} \/>\n\s+<LiveLocationShare \/>/);
});
