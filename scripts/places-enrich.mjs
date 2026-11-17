/* Resolves every researched place against Google Places, and applies the
 * owner's quality floor with Google's own numbers.
 *
 *   node --env-file=.env scripts/places-enrich.mjs [sources/entries/research/*.json]
 *
 * Needs GOOGLE_MAPS_KEY (in .env, which is not committed) with the Places API
 * (New) enabled. For each row that is a venue it runs one Text Search near
 * Chennai and takes Google's place ID, rating, review count, business status,
 * location and Maps link. Then:
 *
 *   kept      rating above 4.0 with at least 20 reviews, operational, and the
 *             name shares a real word with ours. Google's coordinates and
 *             Maps link replace ours; "Google 4.6 (312)" goes into notes.
 *   dropped   below the floor, permanently closed, or Google found nothing
 *             that matches. Never silently: each is listed in the report.
 *   refused   a row may name a Google listing it must not match
 *             (reject_place_id) — found once to be another branch.
 *   exempt    rows that are not venues — communities, delivery-only kitchens
 *             (map_eligible "no") — pass through unchanged.
 *
 * Writes sources/entries/enriched/<same name>.json for merge-places.mjs to
 * read, and reports/places-enrich.csv listing every row and what happened to
 * it. Responses are cached in .cache/places-enrich.json, so a rerun costs
 * nothing for rows already looked up.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.GOOGLE_MAPS_KEY;
if (!KEY) { console.error('Set GOOGLE_MAPS_KEY (e.g. in .env, then run with node --env-file=.env).'); process.exit(1); }

const ROOT = path.resolve(import.meta.dirname, '..');
const MIN_RATING = 4.0; // must be above this
const MIN_REVIEWS = 20; // and at least this many
const CENTRE = { latitude: 13.05, longitude: 80.22 };
const CACHE = path.join(ROOT, '.cache/places-enrich.json');
const OUT_DIR = path.join(ROOT, 'sources/entries/enriched');
const REPORT = path.join(ROOT, 'reports/places-enrich.csv');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(path.join(ROOT, 'sources/entries/research')).filter((f) => f.endsWith('.json'))
    .map((f) => path.join('sources/entries/research', f));

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => { mkdirSync(path.dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); };

/* Words that say what kind of place it is rather than which one. Two names
   sharing only these ("… Counselling Center" and "Gilead … Counselling") are
   not the same place. */
const GENERIC = new Set(['the', 'and', 'for', 'with', 'from', 'of', 'by', 'at', 'chennai', 'madras', 'india', 'clinic', 'clinics', 'centre', 'center', 'studio',
  'fitness', 'gym', 'hospital', 'hospitals', 'store', 'stores', 'shop', 'care', 'health', 'healthcare', 'pvt', 'ltd',
  'private', 'limited', 'counselling', 'counseling', 'psychology', 'psychological', 'psychiatry', 'psychiatric',
  'psychiatrist', 'mental', 'mind', 'minds', 'wellness', 'wellbeing', 'therapy', 'services', 'multispeciality',
  'multi', 'speciality', 'specialty', 'diagnostics', 'diagnostic', 'scans', 'labs', 'lab', 'physiotherapy', 'physio',
  'rehab', 'dental', 'dentist', 'eye', 'sports', 'sport', 'academy', 'arena', 'court', 'courts', 'turf', 'club',
  'yoga', 'organic', 'cafe', 'kitchen', 'foods', 'food', 'juice', 'bar', 'nutrition', 'pharmacy', 'cycles', 'cycle',
  'centre', 'trust', 'foundation', 'research', 'institute', 'international', 'world', 'new', 'best', 'top']);
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 || /^\d+$/.test(w));
const distinct = (s) => new Set(tokens(s).filter((w) => !GENERIC.has(w)));
/* "Cult — Anna Nagar": the brand is before the dash, the branch after.
   "TTK Hospital (T.T. Ranganathan …)": either name may be the one Google uses. */
const namesOf = (n) => {
  const brand = String(n || '').split(/\s+[—–]\s+/)[0];
  const inner = [...brand.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  return [brand.replace(/\(.*?\)/g, ' '), ...inner];
};
/* Most of our name's distinctive words must be in Google's — matched against
   Google's name with the spaces taken out, so "Whitetriad" finds "White Triad"
   and "T.T. Ranganathan" finds "T T Ranganathan". One shared word out of two
   is not enough: "Soul Space" is not "Soul and Mind". */
const sameName = (ours, theirs) => {
  const joined = norm(theirs).replace(/[^a-z0-9]/g, '');
  return namesOf(ours).some((name) => {
    const A = [...distinct(name)].map((w) => w.replace(/[^a-z0-9]/g, ''));
    if (A.length) return A.filter((w) => joined.includes(w)).length / A.length > 0.6;
    /* A name made only of generic words ("Psychological Care"): need two of them. */
    const a = new Set(tokens(name)), b = new Set(tokens(theirs));
    return [...a].filter((w) => b.has(w)).length >= 2;
  });
};
/* A branch ("Brand — Area") must be Google's listing in that area, not the
   brand's best-known branch: the address has to name it. */
const branchOf = (n) => (String(n || '').split(/\s+[—–]\s+/)[1] || '').trim();
const inArea = (area, address) => {
  const w = tokens(area).filter((x) => !['nagar', 'road', 'east', 'west', 'north', 'south', 'main'].includes(x));
  const ad = norm(address).replace(/[^a-z0-9]/g, '');
  /* "T. Nagar", "K.K. Nagar", "R.A. Puram" have no word left once the
     initials and "nagar" go, and an empty list used to pass anything —
     which matched the T. Nagar row to the Adyar branch. Compare the
     whole name, run together, instead. */
  if (!w.length) {
    const whole = norm(area).replace(/[^a-z0-9]/g, '');
    return !whole || ad.includes(whole);
  }
  return w.some((x) => ad.includes(x));
};
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * 108500, (lat2 - lat1) * 110570);
const NEAR_M = 1500;
const isVenue = (r) => r.category !== 'Communities' && String(r.map_eligible || 'yes').toLowerCase() !== 'no';

async function search(r) {
  const q = `${r.n}, ${r.ad || r.a || ''}, Chennai`.replace(/\s+/g, ' ');
  if (cache[q]) return cache[q];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri',
      },
      body: JSON.stringify({
        textQuery: q,
        locationBias: { circle: { center: CENTRE, radius: 40000 } },
        maxResultCount: 3,
        languageCode: 'en',
      }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const places = (await res.json()).places || [];
    cache[q] = places;
    return places;
  }
  throw new Error(`Places kept failing for ${q}`);
}

const report = [['file', 'n', 'a', 'outcome', 'reason', 'google_name', 'rating', 'reviews', 'status', 'maps']];
const tally = { kept: 0, exempt: 0, dropped: 0 };
mkdirSync(OUT_DIR, { recursive: true });

for (const file of files) {
  const rows = JSON.parse(readFileSync(path.resolve(ROOT, file), 'utf8'));
  const out = [];
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++];
      if (!isVenue(r)) { out.push(r); tally.exempt++; report.push([path.basename(file), r.n, r.a, 'exempt', 'not a venue', '', '', '', '', '']); continue; }
      const places = await search(r);
      const ourLat = parseFloat(r.lat), ourLon = parseFloat(r.lon);
      const near = (x) => !(ourLat && ourLon) || metres(ourLat, ourLon, x.location.latitude, x.location.longitude) <= NEAR_M;
      const branch = branchOf(r.n);
      const p = places.find((x) => x.id !== r.reject_place_id && sameName(r.n, x.displayName?.text) && near(x) && (!branch || [branch, r.a].some((a) => inArea(a, `${x.formattedAddress} ${x.displayName?.text || ''}`))));
      const say = (outcome, reason) => report.push([path.basename(file), r.n, r.a, outcome, reason,
        p?.displayName?.text || places[0]?.displayName?.text || '', p?.rating ?? '', p?.userRatingCount ?? '', p?.businessStatus || '', p?.googleMapsUri || '']);
      if (!p) { tally.dropped++; say('dropped', places.length ? 'no Google result with a matching name' : 'not found on Google'); continue; }
      if (p.businessStatus === 'CLOSED_PERMANENTLY') { tally.dropped++; say('dropped', 'permanently closed'); continue; }
      if (!(p.rating > MIN_RATING) || !((p.userRatingCount || 0) >= MIN_REVIEWS)) {
        tally.dropped++; say('dropped', `below the floor: ${p.rating ?? 'no rating'} from ${p.userRatingCount ?? 0} reviews`); continue;
      }
      const g = `Google ${p.rating} (${p.userRatingCount})`;
      const notes = [g, String(r.notes || '').replace(/Google\s+\d(\.\d)?\s*\(\d[\d,]*\)\s*;?\s*/g, '').trim()].filter(Boolean).join('; ');
      out.push({
        ...r,
        lat: String(p.location.latitude), lon: String(p.location.longitude),
        gm: p.googleMapsUri || r.gm || '',
        ad: r.ad || p.formattedAddress || '',
        notes: p.businessStatus === 'CLOSED_TEMPORARILY' ? `${notes}; Google says temporarily closed` : notes,
        google_place_id: p.id,
      });
      tally.kept++;
      say('kept', g);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  saveCache();
  writeFileSync(path.join(OUT_DIR, path.basename(file)), JSON.stringify(out, null, 1) + '\n');
  console.log(`${path.basename(file)}: ${rows.length} rows → ${out.length} kept or exempt`);
}

mkdirSync(path.dirname(REPORT), { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(REPORT, report.map((r) => r.map(csv).join(',')).join('\n') + '\n');
console.log(`\n${tally.kept} kept on Google's numbers, ${tally.exempt} exempt (not venues), ${tally.dropped} dropped — see ${path.relative(ROOT, REPORT)}`);
