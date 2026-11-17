/* Chennai's region keys (src/data/corporations.json) and the region a point
 * falls in (src/data/corporation-areas.json), shared by the ingest scripts.
 *
 * A sheet can leave `rg` blank, or write it the way people say it ("North
 * Madras", "OMR", a zone name); RG_ALIAS folds the common spellings onto a key,
 * and zoneAt() fills a blank from the pin itself.
 */
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));

export const ZONE_KEYS = new Set(read('corporations.json').map((c) => c.k));

export const RG_ALIAS = {
  'North Chennai': 'North', 'North Madras': 'North', Tiruvottiyur: 'North', Manali: 'North', Madhavaram: 'North', Tondiarpet: 'North', Royapuram: 'North',
  'Central Chennai': 'Central', 'Thiru. Vi. Ka. Nagar': 'Central', 'Anna Nagar': 'Central', Teynampet: 'Central', Kodambakkam: 'Central',
  'West Chennai': 'West', Ambattur: 'West', Valasaravakkam: 'West', Alandur: 'West',
  'South Chennai': 'South', Adyar: 'South', Perungudi: 'South', Sholinganallur: 'South', OMR: 'South', ECR: 'South',
  'Tambaram Corporation': 'Tambaram', TCMC: 'Tambaram', 'Avadi Corporation': 'Avadi', ACMC: 'Avadi',
};

const areas = read('corporation-areas.json').features;
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* The zone key a [lon, lat] falls in, or '' outside the city. */
export function zoneAt(lon, lat) {
  if (lon == null || lat == null) return '';
  const hit = areas.find((f) => polysOf(f.geometry).some((p) => inRing([lon, lat], p[0]) && !p.slice(1).some((h) => inRing([lon, lat], h))));
  return hit?.properties.rg || '';
}
