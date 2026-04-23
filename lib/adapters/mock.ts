import leadsData from "@/data/leads.json";
import type {
  FteKlasse,
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

const data = leadsData as unknown as LeadsJson;

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

function matchesRegio(lead: Lead, regio: string): boolean {
  if (!regio.trim()) return true;
  const q = regio.trim().toLowerCase();
  return (
    lead.plaats.toLowerCase().includes(q) ||
    lead.provincie.toLowerCase().includes(q)
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
    if (!search) {
      return { search_id: searchId, titel: "Geen resultaten", leads: [] };
    }

    const filtered = search.leads.filter(
      (l) =>
        matchesFte(l, filters.fte_klassen) &&
        matchesRegio(l, filters.regio_plaats),
    );

    const warmteRank: Record<Lead["warmte"], number> = {
      HOT: 0,
      WARM: 1,
      COLD: 2,
    };
    const sorted = [...filtered].sort(
      (a, b) => warmteRank[a.warmte] - warmteRank[b.warmte],
    );

    return { search_id: search.id, titel: search.titel, leads: sorted };
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
