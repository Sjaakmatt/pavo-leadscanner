export type Warmte = "HOT" | "WARM" | "COLD";

export type Bron =
  | "KvK"
  | "KvK-historie"
  | "KvK-deponering"
  | "Jobdigger"
  | "bedrijfswebsite"
  | "Rechtspraak.nl"
  | "Nieuws"
  | "CBS"
  | "LinkedIn-bedrijfspagina"
  | "Glassdoor";

export type Signaal = {
  tekst: string;
  bron: Bron;
};

export type DienstCode = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8";

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
};

export type SearchResult = {
  search_id: string;
  titel: string;
  leads: Lead[];
};

export interface LeadSource {
  runSearch(filters: SearchFilters): Promise<SearchResult>;
  getLead(kvk: string): Promise<Lead | null>;
}
