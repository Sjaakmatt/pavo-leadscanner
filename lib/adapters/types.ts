export type Warmte = "HOT" | "WARM" | "COLD";

export type Bron =
  | "KvK"
  | "KvK-historie"
  | "KvK-deponering"
  | "Vacatures"
  | "bedrijfswebsite"
  | "Rechtspraak.nl"
  | "NLA"
  | "Insolventieregister"
  | "Nieuws"
  | "CBS"
  | "LinkedIn-bedrijfspagina"
  | "Glassdoor";

export type Signaal = {
  tekst: string;
  bron: Bron;
  // Optioneel — wordt door de productie-laag aangeleverd uit
  // signals.bewijs (letterlijke quote(s)) en signals.bron_url
  // (klikbare link). Demo-data heeft deze velden meestal niet, dus
  // zijn ze optioneel zodat de UI graceful degradeert.
  bewijs?: string[];
  bronUrl?: string;
};

export type DienstCode =
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "D5"
  | "D6"
  | "D7"
  | "D8"
  | "D9"
  | "D10"
  | "D11"
  | "D12"
  | "D13";

export type DienstMatch = {
  code: DienstCode;
  naam: string;
  prioriteit: "primair" | "secundair";
  score: number;
};

export type ArchetypeCode =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "A7"
  | "A8";

export type Archetype = {
  code: ArchetypeCode;
  naam: string;
  beschrijving: string;
};

export type FteKlasse = "10-19" | "20-49" | "50-99" | "100-199";

export type LatLng = { lat: number; lng: number };

export type Lead = {
  id: string;
  naam: string;
  kvk: string;
  plaats: string;
  provincie: string;
  sector: string;
  fte_klasse: FteKlasse;
  warmte: Warmte;
  archetype: Archetype | null;
  signalen: Signaal[];
  diensten: DienstMatch[];
  observatie: string;
  // Voor COLD leads: korte lijst met concrete redenen waarom er geen
  // HR-signalen zijn gevonden. Optional zodat HOT/WARM 'm gewoon
  // weglaten en oude data zonder veld blijft werken.
  cold_redenen?: string[];
  // Optional so leads without coordinates still load. When regio_center is
  // set on a search, leads without coords are excluded.
  lat?: number;
  lng?: number;
};

export type SearchFilters = {
  fte_klassen: FteKlasse[];
  branche: string;
  regio_center: LatLng | null;
  regio_straal_km: number;
  signaal_query: string;
  /**
   * Optionele runtime override op het max-aantal betaalde KvK-basisprofielen
   * per zoekopdracht. Default uit env-var `MAX_BASISPROFIELEN_PER_SEARCH`
   * (200). Wordt server-side gecapped op het hard-ceiling om kosten-uit-
   * de-hand-lopen te voorkomen.
   */
  max_basisprofielen?: number;
};

export type SearchResult = {
  search_id: string;
  titel: string;
  leads: Lead[];
  // Set when strict filters returned nothing and the adapter expanded
  // the search. UI can surface this so the user knows what happened.
  relaxation: {
    regio: boolean;
    fte: boolean;
  };
};

// Voortgangs-events die de productie-pijplijn uitzendt tijdens een
// runSearch. De demo-bron emit geen events — SSE-route valt dan stil,
// wat prima is.
export type SearchProgressEvent =
  | { type: "stage"; stage: string; message: string }
  | { type: "kvk"; totalCandidates: number }
  | { type: "geo"; remaining: number }
  | { type: "scrape"; kvk: string; naam: string; scraped: number; total: number; costUsd: number }
  | { type: "score"; scored: number; total: number }
  // Incremental delivery — emit per lead zodra hij gescoord is, zodat
  // de UI 'em direct kan tonen.
  | { type: "lead"; lead: Lead }
  | { type: "done"; totalLeadsReturned: number; totalCostUsd: number; durationMs: number }
  | { type: "error"; message: string };

export type RunSearchOptions = {
  onEvent?: (event: SearchProgressEvent) => void;
  // Negeert de 30-dagen cache en forceert herscrapen van alle kandidaten.
  refresh?: boolean;
  // Org/owner-scope-overrides voor cron + background jobs zonder
  // request-context. Bij user-driven searches blijven deze leeg en
  // pakt de pipeline 'm uit de session.
  orgId?: string | null;
  ownerId?: string | null;
};

export type GetLeadOptions = {
  refresh?: boolean;
};

export interface LeadSource {
  runSearch(filters: SearchFilters, opts?: RunSearchOptions): Promise<SearchResult>;
  getLead(kvk: string, opts?: GetLeadOptions): Promise<Lead | null>;
}
