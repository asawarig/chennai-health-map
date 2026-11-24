#!/usr/bin/env node
/**
 * Draws routes straight from chosen OpenStreetMap ways, for the routes the
 * automatic tracer (snap-routes.mjs) gets wrong: park circuits it stitches
 * into figure-eights, and roads where OSRM wanders off the road the route is
 * named after. Each recipe below lists the ways in running order; a step can
 * take the whole way or the stretch between two points (the nearest vertices
 * are used, and the stretch is walked in whichever direction the points give).
 * Consecutive steps are joined end to start; a join longer than 60 m is
 * reported, since it means a connecting way is missing from the recipe.
 *
 * Run after ingest-routes.mjs. It replaces the line for each recipe's route in
 * src/data/routes.json and marks it traced (provisional: false), so later
 * ingests keep it as long as the sheet's start and end do not move. The
 * script prints each line's start, end and length so the sheet can match.
 *
 *   node scripts/osm-way-routes.mjs [--print]
 *
 * Way geometry is fetched once from Overpass and cached in .cache/.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ROUTES = path.join(ROOT, 'src/data/routes.json');
const CACHE = path.join(ROOT, '.cache/osm-way-routes.json');
const PRINT = process.argv.includes('--print');

/* step: [wayId] whole way as mapped · [wayId, 'rev'] whole way reversed ·
   [wayId, [lat, lon], [lat, lon]] the stretch between the two points ·
   ['pt', [lat, lon]] one point, for a bend a way has no vertex at. */
const RECIPES = {
  /* Anna Nagar Tower Park: the mapped walking track round the north half,
     back down the west side and round the south lawn on the footways. */
  'CHN-RT-12': [
    [1224940519],
    [1150336839, [13.08723, 80.21358], [13.08633, 80.21335]],
    [1150336840, [13.08633, 80.21335], [13.08633, 80.21323]],
    [1224940518, 'rev'],
    [34690271, [13.08619, 80.21471], [13.08617, 80.21549]],
  ],
  /* Boat Club loop: north up Boat Club Road, a short stretch of R.A. Puram
     2nd Main Road, back south down Adyar Gate Club Road and along Boat Club
     3rd Avenue to the start. */
  'CHN-RT-32': [
    [23135527],
    [1364676681, [13.02784, 80.25156], [13.02886, 80.24982]],
    [30437874],
    [27171470, 'rev'],
    [181314854, 'rev'],
  ],
  /* Cathedral Road, Gemini flyover end to the Music Academy junction. */
  'CHN-RT-44': [
    [1081351983],
    [22977044],
    [1149849987],
  ],
  /* Marina loop: south on the promenade to the Lighthouse, back north on
     the sea-side footpath of Kamarajar Salai. */
  'CHN-RT-45': [
    [240459461],
    [369656804, 'rev'],
    [28295241, [13.04339, 80.27980], [13.06431, 80.28375]],
  ],
  /* ICF playground: laps of the ground's edge. */
  'CHN-RT-46': [[554677106]],
  /* The road beside the MRTS: Velachery station to Perungudi station on
     Perungudi Station Road, then the Taramani Link service road to Taramani. */
  'CHN-RT-47': [
    [1103544351, 'rev'],
    [1103544353],
    [425908497],
    [424516686],
    [425879805],
    [1553868051],
    [447993882, 'rev'],
    [1361403931],
    [428736718],
  ],
  /* Velachery–Tambaram road, southbound side, from the MRTS bridge to the
     Pallikaranai flyover, with the marsh to the east. */
  'CHN-RT-48': [
    [30598636],
    [837608994],
    [837608991],
    [1021024228],
    [244466151],
  ],
  /* Poes Garden: up Poes Road, east on Varadarajapuram Main Road, round the
     Poes Garden streets and back down Poes Road. OSM leaves a 70 m gap where
     Poes Road meets the Poes Garden lane; the line runs straight across it. */
  'CHN-RT-49': [
    [27491933],
    [4719051, [13.04149, 80.25197], [13.04146, 80.25284]],
    ['pt', [13.041442, 80.25423]],
    [993793880, 'rev'],
    [23842570, [13.04243, 80.25427], [13.04349, 80.25423]],
    [27492055],
    [1053283274],
    [22967060],
    [27491933, 'rev'],
  ],
};
const LOOPS = new Set(['CHN-RT-12', 'CHN-RT-32', 'CHN-RT-45', 'CHN-RT-46', 'CHN-RT-49']);

const R = 6371000, rad = (x) => (x * Math.PI) / 180;
const dist = (a, b) => { // [lat, lon]
  const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const lengthM = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

async function fetchWays(ids) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const missing = ids.filter((id) => !cache[id]);
  if (missing.length) {
    const query = `[out:json][timeout:120];way(id:${missing.join(',')});out geom;`;
    let data;
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      try {
        const res = await fetch(ep, { method: 'POST', body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chennai-health-map/1.0 (route build)' } });
        if (res.ok) { data = await res.json(); break; }
      } catch { /* next server */ }
    }
    if (!data) throw new Error('Overpass did not answer; try again in a minute');
    for (const w of data.elements) cache[w.id] = w.geometry.map((p) => [p.lat, p.lon]);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
  return cache;
}

const nearest = (pts, p) => pts.reduce((best, q, i) => (dist(q, p) < dist(pts[best], p) ? i : best), 0);

function build(id, steps, ways) {
  const out = [];
  for (const [wid, a, b] of steps) {
    if (wid === 'pt') { out.push(a); continue; }
    const g = ways[wid];
    if (!g) throw new Error(`${id}: way ${wid} not found`);
    let seg;
    if (a === 'rev') seg = [...g].reverse();
    else if (Array.isArray(a)) {
      const i = nearest(g, a), j = nearest(g, b);
      seg = i <= j ? g.slice(i, j + 1) : g.slice(j, i + 1).reverse();
    } else seg = g;
    if (out.length) {
      const gap = dist(out.at(-1), seg[0]);
      if (gap > 60) console.warn(`  ${id}: ${Math.round(gap)} m join before way ${wid}`);
      if (gap < 1) seg = seg.slice(1);
    }
    out.push(...seg);
  }
  return out;
}

const ways = await fetchWays([...new Set(Object.values(RECIPES).flat().map((s) => s[0]).filter((w) => w !== 'pt'))]);
const routes = JSON.parse(fs.readFileSync(ROUTES, 'utf8'));
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/entries.json'), 'utf8'));
/* Lines traced by hand from the owner's screenshots of Strava running
   segments: each was georeferenced, then routed on foot through waypoints
   every ~300 m along the trace (routing.openstreetmap.de), so it follows OSM
   paths. They live in a file of their own, since there are no way ids. */
const TRACED = path.join(ROOT, 'sources/routes/traced-lines.geojson');
const traced = fs.existsSync(TRACED) ? JSON.parse(fs.readFileSync(TRACED, 'utf8')).features : [];
for (const t of traced) if (t.properties.loop) LOOPS.add(t.properties.id);
const jobs = [
  ...Object.entries(RECIPES).filter(([, steps]) => steps.length).map(([id, steps]) => [id, () => build(id, steps, ways), 'osm:ways']),
  ...traced.map((t) => [t.properties.id, () => t.geometry.coordinates.map(([lo, la]) => [la, lo]), 'osrm-foot:traced']),
];
for (const [id, make, source] of jobs) {
  const pts = make();
  /* A circuit ends where it began. */
  const closing = dist(pts.at(-1), pts[0]);
  if (closing > 1 && closing < 150 && LOOPS.has(id)) pts.push(pts[0]);
  const km = lengthM(pts) / 1000;
  const r6 = (x) => +x.toFixed(6);
  console.log(`${id}: ${pts.length} points, ${km.toFixed(2)} km, start ${r6(pts[0][0])},${r6(pts[0][1])} end ${r6(pts.at(-1)[0])},${r6(pts.at(-1)[1])}`);
  if (PRINT) continue;
  let f = routes.features.find((x) => (x.properties?.id || x.id) === id);
  if (!f) {
    /* A loop with no waypoints gets no placeholder line from the ingest;
       build its feature from the entry the ingest wrote. */
    const e = entries.find((x) => x.id === id);
    if (!e) { console.warn(`  ${id}: no entry (run ingest-routes.mjs first) — skipped`); continue; }
    const loop = LOOPS.has(id);
    const start = [r6(pts[0][0]), r6(pts[0][1])], end = [r6(pts.at(-1)[0]), r6(pts.at(-1)[1])];
    f = { type: 'Feature', id, properties: { id, name: e.n, area: e.a, g: e.g, km: +km.toFixed(2), loop,
      geom_type: loop ? 'loop' : 'point-to-point', start, end, mode: e.route_mode } };
    routes.features.push(f);
  }
  f.geometry = { type: 'LineString', coordinates: pts.map(([la, lo]) => [r6(lo), r6(la)]) };
  f.properties = { ...f.properties, source, provisional: false, snapped_km: +km.toFixed(2) };
}
if (!PRINT) fs.writeFileSync(ROUTES, `${JSON.stringify(routes, null, 2)}\n`);
