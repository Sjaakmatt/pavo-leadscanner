// Shared type definitions for the PAVO HR scraper subsystem.
//
// Every scraper produces Signaal[] entries that point back to one of the
// SignaalCategorie values below. The three clusters map directly onto the
// PAVO value proposition (see briefing): Cluster 1 = HR-structuur (highest
// business value), Cluster 2 = operationeel HR, Cluster 3 = administratie.
// Cross-cluster items use "context".

export type TestCompany = {
  id: string;
  naam: string;
  // Aliases to try when the primary `naam` doesn't surface hits. Scrapers
  // that do text-search over a source first try `naam`, then walk through
  // this list until a hit is found or the list is exhausted.
  zoeknamen: string[];
  url: string;
  // KvK-nummer is optioneel — niet elk publiek bedrijfsprofiel vermeldt
  // deze prominent; we dwingen het niet af in de scrapers.
  kvk?: string;
  verwachteFte: number;
  sector: string;
  // Verwachte PAVO-cluster vooraf — handig als smoketest: als het bedrijf
  // na scrapen in een heel ander cluster scoort weten we dat óf de data
  // verrassingen bevat óf onze verwachting niet klopte.
  cluster: 1 | 2 | 3;
  notitie: string;
};

// Cluster 1: HR-structuur signals
export type Cluster1Categorie =
  | "geen_hr_rol_zichtbaar"
  | "snelle_groei"
  | "veel_functies_geen_structuur"
  | "negatieve_reviews_chaos"
  | "verzuim_burnout_signalen"
  | "nieuwe_managementlaag"
  | "internationale_uitbreiding"
  | "arbeidsrechtzaak_recent"
  | "arbeidsrechtzaak_patroon"
  | "arbo_boete_recent"
  | "arbeidsinspectie_stillegging"
  | "asbest_overtreding";

// Cluster 2: operationeel HR
export type Cluster2Categorie =
  | "veel_open_vacatures"
  | "langlopende_vacatures"
  | "herposte_vacatures"
  | "hiring_manager_actief"
  | "recruiter_overload"
  | "seizoenspieken";

// Cluster 3: administratie
export type Cluster3Categorie =
  | "klein_team_in_groei"
  | "geen_hr_finance_roles"
  | "founder_run"
  | "veel_freelancers"
  | "loonadministratie_klachten"
  | "nieuwe_bv";

// Cross-cluster context
export type ContextCategorie =
  | "bedrijfsomvang"
  | "bestuursvorm"
  | "sector_context"
  | "failliet_of_surseance";

export type SignaalCategorie =
  | Cluster1Categorie
  | Cluster2Categorie
  | Cluster3Categorie
  | ContextCategorie;

export type ClusterId = 1 | 2 | 3 | "context";

export type Signaal = {
  categorie: SignaalCategorie;
  cluster: ClusterId;
  sterkte: number; // 0-100 how strong the evidence is
  confidence: number; // 0-100 how confident we are in the detection
  observatie: string; // short Dutch explanation (for Roy / the consultant)
  bewijs?: string[]; // quoted evidence from the source
  bron_url?: string;
};

export type ScraperVerdict =
  | "productie_klaar"
  | "werkt_met_aanpassing"
  | "fragiel"
  | "niet_werkbaar";

export type CompanyResult = {
  company: TestCompany;
  success: boolean;
  durationMs: number;
  hitCount: number;
  signals: Signaal[];
  cost: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  };
  error?: string;
  debug?: Record<string, unknown>;
};

export type ScraperReport = {
  scraper: string;
  startedAt: string;
  finishedAt: string;
  companiesAttempted: number;
  companiesSucceeded: number;
  totalSignals: number;
  verdict: ScraperVerdict;
  verdict_toelichting: string; // Dutch explanation aimed at Sjaak / Roy
  totalCost: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  };
  results: CompanyResult[];
};

// Cluster assignment per category — used by all scrapers so the value is
// always consistent (never 0, always 1 | 2 | 3 | "context").
export const CLUSTER_FOR: Record<SignaalCategorie, ClusterId> = {
  geen_hr_rol_zichtbaar: 1,
  snelle_groei: 1,
  veel_functies_geen_structuur: 1,
  negatieve_reviews_chaos: 1,
  verzuim_burnout_signalen: 1,
  nieuwe_managementlaag: 1,
  internationale_uitbreiding: 1,
  arbeidsrechtzaak_recent: 1,
  arbeidsrechtzaak_patroon: 1,
  arbo_boete_recent: 1,
  arbeidsinspectie_stillegging: 1,
  asbest_overtreding: 1,
  veel_open_vacatures: 2,
  langlopende_vacatures: 2,
  herposte_vacatures: 2,
  hiring_manager_actief: 2,
  recruiter_overload: 2,
  seizoenspieken: 2,
  klein_team_in_groei: 3,
  geen_hr_finance_roles: 3,
  founder_run: 3,
  veel_freelancers: 3,
  loonadministratie_klachten: 3,
  nieuwe_bv: 3,
  bedrijfsomvang: "context",
  bestuursvorm: "context",
  sector_context: "context",
  failliet_of_surseance: "context",
};
