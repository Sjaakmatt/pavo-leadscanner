import type { LatLng } from "./types";

// Centrum-coördinaten voor de steden die in leads.json voorkomen.
// Mock-only: in productie geocodeert de ingest-pipeline het
// vestigingsadres per KvK-record via PDOK en schrijft lat/lng weg bij
// het record zelf — deze tabel verdwijnt dan.
export const CITY_COORDS: Record<string, LatLng> = {
  Alkmaar: { lat: 52.6316, lng: 4.7484 },
  Almelo: { lat: 52.357, lng: 6.6631 },
  Almere: { lat: 52.3508, lng: 5.2647 },
  Amersfoort: { lat: 52.1561, lng: 5.3878 },
  Amsterdam: { lat: 52.3676, lng: 4.9041 },
  Apeldoorn: { lat: 52.2112, lng: 5.9699 },
  Arnhem: { lat: 51.9851, lng: 5.8987 },
  Breda: { lat: 51.5719, lng: 4.7683 },
  Delft: { lat: 52.0116, lng: 4.3571 },
  Deventer: { lat: 52.2551, lng: 6.1639 },
  Doetinchem: { lat: 51.9654, lng: 6.2886 },
  Eindhoven: { lat: 51.4416, lng: 5.4697 },
  Enschede: { lat: 52.2215, lng: 6.8937 },
  Gouda: { lat: 52.0115, lng: 4.7106 },
  Groningen: { lat: 53.2194, lng: 6.5665 },
  Haarlem: { lat: 52.3874, lng: 4.6462 },
  Harderwijk: { lat: 52.341, lng: 5.6208 },
  Helmond: { lat: 51.4826, lng: 5.6611 },
  Hengelo: { lat: 52.2658, lng: 6.7929 },
  Hoogeveen: { lat: 52.7225, lng: 6.4764 },
  Nijmegen: { lat: 51.8126, lng: 5.8372 },
  Oldenzaal: { lat: 52.3137, lng: 6.9301 },
  Rotterdam: { lat: 51.9244, lng: 4.4777 },
  Tilburg: { lat: 51.5555, lng: 5.0913 },
  Utrecht: { lat: 52.0907, lng: 5.1214 },
  Veenendaal: { lat: 52.0276, lng: 5.5583 },
  Venlo: { lat: 51.3704, lng: 6.1724 },
  Zaandam: { lat: 52.4389, lng: 4.8278 },
  Zwolle: { lat: 52.5168, lng: 6.083 },
};

export function coordsForPlaats(plaats: string): LatLng | null {
  return CITY_COORDS[plaats] ?? null;
}
