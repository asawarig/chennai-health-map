/* Rebuilds the map's boundary layers from OpenStreetMap.
 *
 *   node scripts/osm-boundaries.mjs
 *
 * Greater Chennai Corporation (relation 1766358) has 15 zones at admin_level 9
 * (Zone 1 Tiruvottiyur … Zone 15 Sholinganallur) and 200 wards under them at
 * admin_level 10. Two hundred numbered wards mean little to anyone choosing
 * where to run, so the map's clickable areas are the 15 zones, which people do
 * know by name ("Adyar zone"). The coloured ground is six regions: four groups
 * of GCC zones (North, Central, West, South Chennai) plus Tambaram and Avadi,
 * whose taluks stand in for their corporations (see scripts/city.mjs). The map
 * calls the regions "corporations" and the zones "wards", the words the code
 * inherited from Bengaluru. Nominatim returns every relation as an assembled,
 * lightly simplified polygon. Writes:
 *
 *   src/data/zones.json               one polygon per zone, tagged with its region
 *   src/data/corporation-areas.json   the six regions, for the basemap's ground colours
 *   src/data/mask.json                the city cut out of a wide rectangle (the halftone)
 *   src/data/city.json          bounding box and area
 *   src/data/corporations.json  km² per region (hues are left alone)
 *
 * It also reports entries whose `rg` disagrees with the region their pin
 * actually falls in. It does not rewrite entries.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { union } from 'polyclip-ts';
import { CITY_RELS } from './city.mjs';

const DATA = new URL('../src/data/', import.meta.url);
const UA = 'chennai-wellness-map/1.0 (boundary build script)';

/* GCC's zones as OSM has them (admin_level 9), and the region each is drawn in. */
const ZONES = [
  { id: 7885949, n: 1, name: 'Tiruvottiyur', rg: 'North' },
  { id: 7886090, n: 2, name: 'Manali', rg: 'North' },
  { id: 7886220, n: 3, name: 'Madhavaram', rg: 'North' },
  { id: 7883921, n: 4, name: 'Tondiarpet', rg: 'North' },
  { id: 7883985, n: 5, name: 'Royapuram', rg: 'North' },
  { id: 7887530, n: 6, name: 'Thiru. Vi. Ka. Nagar', rg: 'Central' },
  { id: 7888246, n: 7, name: 'Ambattur', rg: 'West' },
  { id: 7887722, n: 8, name: 'Anna Nagar', rg: 'Central' },
  { id: 7880733, n: 9, name: 'Teynampet', rg: 'Central' },
  { id: 7888502, n: 10, name: 'Kodambakkam', rg: 'Central' },
  { id: 7888806, n: 11, name: 'Valasaravakkam', rg: 'West' },
  { id: 7888805, n: 12, name: 'Alandur', rg: 'West' },
  { id: 7880736, n: 13, name: 'Adyar', rg: 'South' },
  { id: 7879836, n: 14, name: 'Perungudi', rg: 'South' },
  { id: 7876675, n: 15, name: 'Sholinganallur', rg: 'South' },
];
/* Regions that are one relation each, standing as their own single "ward". */
const SINGLE = { Tambaram: 10326121, Avadi: 21492307 };

/* What each zone is known for, so "Zone 9" reads as somewhere. */
const ZONE_AREAS = {
  1: 'Tiruvottiyur, Ennore', 2: 'Manali, Mathur', 3: 'Madhavaram, Puzhal', 4: 'Tondiarpet, Vyasarpadi',
  5: 'Royapuram, George Town, Egmore', 6: 'Perambur, Kolathur, Pulianthope', 7: 'Ambattur, Mogappair, Korattur',
  8: 'Anna Nagar, Kilpauk, Aminjikarai', 9: 'Teynampet, Mylapore, Nungambakkam, T. Nagar', 10: 'Kodambakkam, Vadapalani, K.K. Nagar, Saidapet',
  11: 'Valasaravakkam, Porur, Virugambakkam', 12: 'Alandur, Guindy, Nanganallur', 13: 'Adyar, Besant Nagar, Velachery, Thiruvanmiyur',
  14: 'Perungudi, Pallikaranai, Taramani', 15: 'Sholinganallur, Neelankarai, Injambakkam',
};
const read = (f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'));
const write = (f, j, pretty = false) => {
  const s = JSON.stringify(j, null, pretty ? 2 : 0);
  writeFileSync(new URL(f, DATA), s + '\n');
  console.log(`wrote ${f} (${(s.length / 1024).toFixed(0)} KB)`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Public Overpass instances answer 429/504 when busy, so try each in turn. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpass(q) {
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(240000), // a hung mirror must not stall the run
        });
        if (res.ok) return (await res.json()).elements;
        errors.push(`${new URL(url).host} ${res.status}`);
      } catch (e) {
        errors.push(`${new URL(url).host} ${e.message}`);
      }
    }
    await sleep(5000);
  }
  throw new Error(`No Overpass instance answered: ${errors.join(', ')}`);
}

async function lookup(ids, threshold) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const url = 'https://nominatim.openstreetmap.org/lookup?format=geojson&polygon_geojson=1'
      + `&polygon_threshold=${threshold}&osm_ids=` + ids.slice(i, i + 50).map((id) => 'R' + id).join(',');
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
    (await res.json()).features.forEach((f) => out.set(f.properties.osm_id, f));
    await sleep(1100); // Nominatim's usage policy: at most one request a second
  }
  return out;
}

/* ---------- geometry ---------- */
const round = (ring) => ring.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const roundGeom = (g) => {
  const polys = polysOf(g).map((p) => p.map(round));
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
};

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (pt, polys) => polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));

/* Joins a relation's member ways end to end into closed rings. */
function closeRings(ways) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const segs = ways.map((w) => w.geometry.map((p) => [p.lon, p.lat]));
  const out = [];
  while (segs.length) {
    let ring = segs.shift();
    while (!same(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1];
      const i = segs.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) return null;
      const s = segs.splice(i, 1)[0];
      ring = ring.concat((same(s[0], end) ? s : [...s].reverse()).slice(1));
    }
    out.push(ring);
  }
  return out;
}

function assembleRelation(rel) {
  const ways = rel.members.filter((m) => m.type === 'way' && m.geometry);
  const outers = closeRings(ways.filter((m) => m.role !== 'inner'));
  const inners = closeRings(ways.filter((m) => m.role === 'inner')) || [];
  if (!outers?.length) return null;
  const polys = outers.map((o) => [o, ...inners.filter((h) => inRing(h[0], o))]);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

const R = 6371008.8, RAD = Math.PI / 180;
function ringKm2(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return Math.abs((s * R * R) / 2) / 1e6;
}
const km2 = (polys) => polys.reduce((a, p) => a + ringKm2(p[0]) - p.slice(1).reduce((b, h) => b + ringKm2(h), 0), 0);

/* ---------- fetch ---------- */
console.log('Fetching zone polygons from Nominatim…');
const zoneGeo = await lookup([...ZONES.map((z) => z.id), ...Object.values(SINGLE)], 0.00002);
for (const id of [...ZONES.map((z) => z.id), ...Object.values(SINGLE)]) {
  if (!zoneGeo.has(id)) throw new Error(`Nominatim did not return relation ${id}`);
}

console.log('Joining the city outline…');
const dist = await lookup(CITY_RELS, 0.00002);
const parts = CITY_RELS.map((id) => {
  const f = dist.get(id) || zoneGeo.get(id);
  if (!f) throw new Error(`Nominatim did not return city relation ${id}`);
  return polysOf(f.geometry);
});
/* Specks under 0.05 km² are left out. */
const cityGeom = {
  type: 'MultiPolygon',
  coordinates: union(...parts).filter((p) => ringKm2(p[0]) > 0.05).map((p) => [p[0]]),
};
if (!cityGeom.coordinates.length) throw new Error('Could not join the city outline');
const cityPolys = polysOf(cityGeom);
console.log(`  city outline: ${cityPolys.length} ring(s), ${cityPolys.reduce((a, p) => a + p[0].length, 0)} points`);

/* Each region is the union of its zones. */
const corpPolys = {};
for (const z of ZONES) (corpPolys[z.rg] ||= []).push(polysOf(zoneGeo.get(z.id).geometry));
for (const rg of Object.keys(corpPolys)) {
  corpPolys[rg] = union(...corpPolys[rg]).filter((p) => ringKm2(p[0]) > 0.01);
}
for (const [rg, id] of Object.entries(SINGLE)) corpPolys[rg] = polysOf(zoneGeo.get(id).geometry);
const asGeom = (polys) => (polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });

const corpsMeta = read('corporations.json');
const entries = read('entries.json');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const areaByNorm = new Map();
entries.forEach((r) => { if (r.a) areaByNorm.set(norm(r.a), r.a); });

const wards = ZONES.map((z) => {
  const ward = `${z.name} (Zone ${z.n}: ${ZONE_AREAS[z.n]})`;
  return {
    type: 'Feature',
    properties: { rg: z.rg, ward, area: areaByNorm.get(norm(z.name)) || '', osm: z.id },
    geometry: roundGeom(zoneGeo.get(z.id).geometry),
  };
});
for (const [rg, id] of Object.entries(SINGLE)) {
  const label = corpsMeta.find((c) => c.k === rg)?.label || rg;
  wards.push({ type: 'Feature', properties: { rg, ward: label, area: areaByNorm.get(norm(rg)) || '', osm: id }, geometry: roundGeom(zoneGeo.get(id).geometry) });
}
wards.sort((a, b) => a.properties.rg.localeCompare(b.properties.rg) || a.properties.ward.localeCompare(b.properties.ward));
console.log(`  ${wards.length} zones across ${Object.keys(corpPolys).length} regions`);

const corps = read('corporations.json');

/* ---------- write ---------- */
write('zones.json', { type: 'FeatureCollection', features: wards });

/* A wide rectangle with the city cut out of it. The cut-out has to wind against
   the rectangle (outer counter-clockwise, holes clockwise, as RFC 7946 says),
   or MapLibre reads the city as a second polygon instead of a hole. */
/* Wide enough that city fit + Leaflet↔GL overscan never runs past the mask. */
const WORLD = [[50, -5], [110, -5], [110, 35], [50, 35], [50, -5]];
const signedArea = (ring) => ring.reduce((s, [x1, y1], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length];
  return s + (x1 * y2 - x2 * y1);
}, 0);
const clockwise = (ring) => (signedArea(ring) < 0 ? ring : [...ring].reverse());
if (cityPolys.some((p) => p.length > 1)) console.log('  note: the city polygon has inner rings; the mask ignores them');
write('mask.json', {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, ...cityPolys.map((p) => clockwise(round(p[0])))] } }],
});

write('corporation-areas.json', {
  type: 'FeatureCollection',
  features: Object.entries(corpPolys).map(([rg, polys]) => ({
    type: 'Feature', properties: { rg }, geometry: roundGeom(asGeom(polys)),
  })),
});

const cityPts = cityPolys.flatMap((p) => p[0]);
const [W, S, E, N] = [Math.min(...cityPts.map((p) => p[0])), Math.min(...cityPts.map((p) => p[1])),
  Math.max(...cityPts.map((p) => p[0])), Math.max(...cityPts.map((p) => p[1]))];
const city = read('city.json');
write('city.json', {
  ...city,
  box: [+S.toFixed(5), +W.toFixed(5), +N.toFixed(5), +E.toFixed(5)],
  gba_km2: Math.round(km2(cityPolys)),
  source: `OpenStreetMap relations ${CITY_RELS.join(' + ')} (Greater Chennai Corporation, and the Tambaram and Avadi taluks standing in for their corporations), fetched ${new Date().toISOString().slice(0, 10)}`,
});
/* Hand-edited (the hue families live here), so it stays readable. */
write('corporations.json', corps.map((c) => ({ ...c, km2: Math.round(km2(corpPolys[c.k])) })), true);

/* ---------- entry check ---------- */
const wrong = [];
let noCorp = 0;
entries.forEach((r) => {
  if (r.lat == null || r.lon == null || r.out) return;
  const actual = Object.keys(corpPolys).find((rg) => inPolys([r.lon, r.lat], corpPolys[rg])) || '';
  if (!actual) { noCorp++; return; }
  if ((r.rg || '') !== actual) wrong.push(`${r.id} ${r.n} (${r.a}): rg=${r.rg || '—'}, pin is in ${actual}`);
});
console.log(`\n${wrong.length} pinned in-city entries carry a different rg than their pin's corporation`
  + (noCorp ? `; ${noCorp} pinned in-city entries fall in no corporation` : ''));
wrong.slice(0, 40).forEach((l) => console.log('  ' + l));
