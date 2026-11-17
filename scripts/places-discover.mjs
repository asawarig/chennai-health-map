/* Finds candidate places on Google Places, for research passes.
 *
 *   node --env-file=.env scripts/places-discover.mjs "psychiatrist in Adyar, Chennai" [more queries…]
 *
 * Prints one JSON line per place found (up to 20 per query): Google's name,
 * address, location, rating, review count, business status, types, website
 * and Maps link, plus `floor`: whether it clears the owner's rule (rating
 * above 4.0, at least 20 reviews, operational). Needs GOOGLE_MAPS_KEY with the
 * Places API (New). Answers are cached in .cache/places-discover.json, so a
 * repeated query costs nothing.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.GOOGLE_MAPS_KEY;
if (!KEY) { console.error('Run with: node --env-file=.env scripts/places-discover.mjs "query"'); process.exit(1); }
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache/places-discover.json');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

async function search(q) {
  if (cache[q]) return cache[q];
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.businessStatus,places.types,places.websiteUri,places.googleMapsUri',
    },
    body: JSON.stringify({
      textQuery: q,
      locationBias: { circle: { center: { latitude: 13.0, longitude: 80.2 }, radius: 35000 } },
      pageSize: 20,
      languageCode: 'en',
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const places = ((await res.json()).places || []).map((p) => ({
    n: p.displayName?.text, ad: p.formattedAddress,
    lat: p.location?.latitude, lon: p.location?.longitude,
    rating: p.rating ?? null, reviews: p.userRatingCount ?? 0, status: p.businessStatus || '',
    types: p.types || [], w: p.websiteUri || '', gm: p.googleMapsUri || '', id: p.id,
  })).map((p) => ({ ...p, floor: p.rating > 4.0 && p.reviews >= 20 && p.status === 'OPERATIONAL' }));
  cache[q] = places;
  return places;
}

for (const q of process.argv.slice(2)) {
  for (const p of await search(q)) console.log(JSON.stringify({ q, ...p }));
}
mkdirSync(path.dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(cache));
