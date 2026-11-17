/* Builds src/data/metro-stations.json: the Chennai Metro stations that are open.
 *
 *   node scripts/osm-metro-stations.mjs
 *
 * Takes OpenStreetMap's stop positions and stations for Chennai Metro (the
 * nodes on the route=subway relations osm-metro.mjs draws), keeps one point
 * per named station, and drops any still tagged as under construction.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'chennai-wellness-map/1.0 (metro stations build script)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const Q = `[out:json][timeout:90];
rel["route"="subway"]["network"="Chennai Metro"];
node(r)->.stops;
(node.stops["railway"="station"];node.stops["public_transport"~"stop_position|station"];);
out tags center;`;

let data = null;
for (const url of OVERPASS) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(Q), signal: AbortSignal.timeout(240000) });
    if (res.ok) { data = await res.json(); break; }
  } catch {}
}
if (!data) throw new Error('Overpass did not answer');
const byName = new Map();
for (const n of data.elements) {
  const t = n.tags || {};
  const name = t['name:en'] || t.name;
  if (!name || /construction|proposed/i.test(`${t.railway || ''} ${t.construction || ''}`)) continue;
  const key = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!byName.has(key)) byName.set(key, { type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [+n.lon.toFixed(6), +n.lat.toFixed(6)] } });
}
/* An interchange is mapped once per line, under each line's own name; within
   200 m of another station it is the same place, and keeps one dot. */
const m = (a, b) => Math.hypot((a[0] - b[0]) * 108500, (a[1] - b[1]) * 110570);
const kept = [];
for (const f of byName.values()) if (!kept.some((k) => m(k.geometry.coordinates, f.geometry.coordinates) < 200)) kept.push(f);
/* Phase 2's stations are mapped long before their track opens, and many are
   not tagged as under construction. A station counts only within 150 m of a
   line metro.json draws, so run osm-metro.mjs first. */
const metro = JSON.parse(readFileSync(new URL('../src/data/metro.json', import.meta.url), 'utf8'));
const track = metro.features.flatMap((f) => f.geometry.coordinates.flat());
const open = kept.filter((f) => track.some((p) => m(p, f.geometry.coordinates) < 150));
console.log(`${kept.length - open.length} stations off any open line, left out`);
const out = { type: 'FeatureCollection', features: open };
writeFileSync(new URL('../src/data/metro-stations.json', import.meta.url), JSON.stringify(out));
console.log(out.features.length, 'stations');
