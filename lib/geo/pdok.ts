// PDOK Locatieserver geocoding. Gratis, geen key, geen rate-limit van
// betekenis voor ons volume (piek-load zit ver onder hun RPS-limiet).
//
// API: https://api.pdok.nl/bzk/locatieserver/search/v3_1/free
// We gebruiken v3_1/free met fq=type:woonplaats om alleen plaatsen terug
// te krijgen; het centroid van de woonplaats dient als ankerpunt voor
// straal-filters.

export type LatLng = { lat: number; lng: number };

const PDOK_SEARCH =
  "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

type PdokDoc = {
  id: string;
  weergavenaam: string;
  // Centroid is a WKT POINT string: "POINT(4.123 52.345)" — longitude
  // first, then latitude (RD→WGS84 already handled by PDOK).
  centroide_ll?: string;
};

type PdokResponse = {
  response?: { docs?: PdokDoc[] };
};

function parseCentroid(wkt: string | undefined): LatLng | null {
  if (!wkt) return null;
  // "POINT(4.123 52.345)"
  const m = wkt.match(/POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// Simple in-memory cache — plaats-centroids change never. Keeps us well
// under PDOK's rate limits even for repeated searches in a single run.
const cache = new Map<string, LatLng | null>();

export async function pdokGeocodePlaats(
  plaats: string,
): Promise<LatLng | null> {
  const key = plaats.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const url = `${PDOK_SEARCH}?q=${encodeURIComponent(plaats)}&fq=type:woonplaats&rows=1&fl=id,weergavenaam,centroide_ll`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Short timeout — PDOK is usually <300ms; if it's slower we'd
      // rather fall back to no-geo-filter than block the search.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = (await res.json()) as PdokResponse;
    const doc = data.response?.docs?.[0];
    const coords = parseCentroid(doc?.centroide_ll);
    cache.set(key, coords);
    return coords;
  } catch {
    cache.set(key, null);
    return null;
  }
}

// Haversine distance in km between two WGS84 coordinates. Accurate
// enough for the ~1-200km radius filters we apply.
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Dutch provinces and their approximate centroids (WGS84). Used to
// coarse-filter candidates when the user's search pin + radius implies
// certain provinces. Not precise — just "is this province plausibly
// within the radius" for KvK's regio-parameter.
export const PROVINCE_CENTROIDS: Record<string, LatLng> = {
  Drenthe: { lat: 52.9475, lng: 6.6231 },
  Flevoland: { lat: 52.5279, lng: 5.5953 },
  Friesland: { lat: 53.1642, lng: 5.7817 },
  Gelderland: { lat: 52.0453, lng: 5.8716 },
  Groningen: { lat: 53.2194, lng: 6.5665 },
  Limburg: { lat: 51.2093, lng: 5.9308 },
  "Noord-Brabant": { lat: 51.4828, lng: 5.2322 },
  "Noord-Holland": { lat: 52.52, lng: 4.788 },
  Overijssel: { lat: 52.4388, lng: 6.5016 },
  Utrecht: { lat: 52.0907, lng: 5.1214 },
  Zeeland: { lat: 51.4938, lng: 3.8497 },
  "Zuid-Holland": { lat: 52.0208, lng: 4.4938 },
};

// Returns province names whose centroid is within `radiusKm` of `center`,
// so the KvK query can coarse-filter before the fine-grained haversine
// filter eliminates stragglers.
export function provincesWithinRadius(
  center: LatLng,
  radiusKm: number,
): string[] {
  // Cap at the nationale diameter — if the radius is huge, return all.
  if (radiusKm >= 250) return Object.keys(PROVINCE_CENTROIDS);
  return Object.entries(PROVINCE_CENTROIDS)
    .filter(([, c]) => haversineKm(center, c) <= radiusKm + 80) // +80km provincie-radius buffer
    .map(([name]) => name);
}
