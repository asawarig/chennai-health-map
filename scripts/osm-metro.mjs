/* Builds src/data/metro.json: the Chennai Metro lines that are running.
 *
 *   node scripts/osm-metro.mjs
 *
 * Takes OpenStreetMap's route=subway relations for Chennai Metro inside the city
 * and keeps only their member ways tagged railway=subway. Track that is still
 * being built is tagged railway=construction in OSM, so it drops out on its
 * own, and a line appears here once OSM shows it open. One feature per line,
 * in the line's colour.
 */

import { writeFileSync } from 'node:fs';
import { CITY_RELS } from './city.mjs';

const UA = 'chennai-wellness-map/1.0 (metro build script)';
/* Chennai Metro's own line colours, keyed by line ref. OSM carries them on
   most relations; this is the fallback and the authority. */
const LINE_COLOUR = { 1: '#3281C4', 2: '#53B848', 3: '#800080', 4: '#F2B705', 5: '#E0453A' };
const LINE_NAME = { 1: 'Blue Line', 2: 'Green Line', 3: 'Purple Line', 4: 'Yellow Line', 5: 'Red Line' };

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpass(q) {
  const errors = [];
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
  throw new Error(`No Overpass instance answered: ${errors.join(', ')}`);
}

const els = await overpass(`[out:json][timeout:120];rel(id:${CITY_RELS.join(',')});map_to_area->.city;
rel["route"="subway"]["network"="Chennai Metro"](area.city)->.r;
.r out body;
way(r.r)["railway"="subway"];out geom;`);

const ways = new Map(els.filter((e) => e.type === 'way').map((w) => [w.id, w]));
const lines = new Map();
for (const rel of els.filter((e) => e.type === 'relation')) {
  /* 2A is a through service (airport to Central) over the Blue and Green
     lines' own track, so it would draw a second line on top of theirs. */
  const ref = rel.tags.ref || (rel.tags.name || 'Metro').replace(/^Line\s+/, '').split(' ')[0];
  if (!LINE_NAME[ref]) continue;
  if (!lines.has(ref)) {
    const hex = /^#[0-9a-f]{6}$/i.test(rel.tags.colour || '') ? rel.tags.colour : '#3A3934';
    lines.set(ref, { ref, colour: LINE_COLOUR[ref] || hex, ways: new Set() });
  }
  rel.members.forEach((m) => { if (m.type === 'way' && ways.has(m.ref)) lines.get(ref).ways.add(m.ref); });
}

const features = [...lines.values()].filter((l) => l.ways.size).map((l) => ({
  type: 'Feature',
  properties: { line: l.ref, name: LINE_NAME[l.ref] || `Line ${l.ref}`, colour: l.colour },
  geometry: {
    type: 'MultiLineString',
    coordinates: [...l.ways].map((id) => ways.get(id).geometry.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)])),
  },
}));

writeFileSync(new URL('../src/data/metro.json', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
console.log(features.map((f) => `${f.properties.name}: ${f.geometry.coordinates.length} ways`).join('\n'));
