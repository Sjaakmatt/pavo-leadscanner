import leadsData from "@/data/leads.json";
import { coordsForPlaats } from "./coords";
import type {
  FteKlasse,
  LatLng,
  Lead,
  LeadSource,
  SearchFilters,
  SearchResult,
} from "./types";

type LeadsJson = {
  meta: {
    diensten: Record<string, string>;
    archetypes: Record<string, string>;
    archetype_beschrijvingen: Record<string, string>;
  };
  searches: Array<{
    id: string;
    titel: string;
    filters: Record<string, unknown>;
    leads: Lead[];
  }>;
};

// One-time enrichment at module load: attach lat/lng from the city
// lookup so the map-filter has something to chew on. Leads where the
// plaats is unknown keep no coords and are simply skipped when a pin
// is set — which is the safe default.
function enrichWithCoords(raw: LeadsJson): LeadsJson {
  return {
    meta: raw.meta,
    searches: raw.searches.map((s) => ({
      ...s,
      leads: s.leads.map((l) => {
        if (l.lat !== undefined && l.lng !== undefined) return l;
        const c = coordsForPlaats(l.plaats);
        return c ? { ...l, lat: c.lat, lng: c.lng } : l;
      }),
    })),
  };
}

const data = enrichWithCoords(leadsData as unknown as LeadsJson);

const BRANCHE_TO_SEARCH_ID: Record<string, string> = {
  "Bouw & installatie": "search-1-bouw",
  "Logistiek & transport": "search-2-logistiek",
  "Zakelijke dienstverlening": "search-3-zakelijk",
  "Productie & techniek": "search-4-productie",
  "Retail & e-commerce": "search-5-retail",
};

function resolveSearchId(branche: string): string {
  if (branche === "Alle branches" || branche === "alle") {
    return data.searches[0]?.id ?? "search-1-bouw";
  }
  return BRANCHE_TO_SEARCH_ID[branche] ?? data.searches[0]?.id ?? "search-1-bouw";
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceKm(a: LatLng, b: LatLng): number {
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

function matchesRegio(
  lead: Lead,
  center: LatLng | null,
  radiusKm: number,
): boolean {
  if (!center) return true;
  if (lead.lat === undefined || lead.lng === undefined) return false;
  return (
    distanceKm(center, { lat: lead.lat, lng: lead.lng }) <= radiusKm
  );
}

function matchesFte(lead: Lead, klassen: FteKlasse[]): boolean {
  if (klassen.length === 0) return true;
  return klassen.includes(lead.fte_klasse);
}

export class MockLeadSource implements LeadSource {
  async runSearch(filters: SearchFilters): Promise<SearchResult> {
    const searchId = resolveSearchId(filters.branche);
    const search = data.searches.find((s) => s.id === searchId);
    const emptyRelaxation = { regio: false, fte: false };
    if (!search) {
      return {
        search_id: searchId,
        titel: "Geen resultaten",
        leads: [],
        relaxation: emptyRelaxation,
      };
    }

    const meetsFte = (l: Lead) => matchesFte(l, filters.fte_klassen);
    const meetsRegio = (l: Lead) =>
      matchesRegio(l, filters.regio_center, filters.regio_straal_km);

    // Strict pass first — honour every filter the user set.
    let leads = search.leads.filter((l) => meetsFte(l) && meetsRegio(l));
    const relaxation = { regio: false, fte: false };

    // Mock datasets are small, so a legit zero-result looks like a bug in
    // a sales demo. Progressively loosen: drop the pin first, then FTE.
    if (leads.length === 0 && filters.regio_center) {
      leads = search.leads.filter(meetsFte);
      relaxation.regio = true;
    }
    if (leads.length === 0) {
      leads = [...search.leads];
      relaxation.fte = true;
      if (filters.regio_center) relaxation.regio = true;
    }

    const warmteRank: Record<Lead["warmte"], number> = {
      HOT: 0,
      WARM: 1,
      COLD: 2,
    };
    const sorted = [...leads].sort(
      (a, b) => warmteRank[a.warmte] - warmteRank[b.warmte],
    );

    return {
      search_id: search.id,
      titel: search.titel,
      leads: sorted,
      relaxation,
    };
  }

  async getLead(kvk: string): Promise<Lead | null> {
    for (const search of data.searches) {
      const lead = search.leads.find((l) => l.kvk === kvk || l.id === kvk);
      if (lead) return lead;
    }
    return null;
  }
}

export const mockLeadSource = new MockLeadSource();
