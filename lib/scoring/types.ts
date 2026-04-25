// PAVO-specifieke types. Leven LOKAAL (niet in @factumai/shared) omdat
// de PAVO 3-cluster framework + 13 diensten consumer-domain is, niet
// herbruikbaar tussen agents.
//
// De bestaande scoring engine in lib/scoring/index.ts werkt op een
// snake_case StoredSignal (DB-shape). Deze file definieert de
// camelCase Signaal-shape die de classificatie-laag produceert; de
// orchestrator transformeert beide.

import { z } from "zod";

// 3-cluster framework + bron-specifieke + context-categorieën.
export const SignaalCategorie = z.enum([
  // Cluster 1 — HR-structuur
  "geen_hr_rol_zichtbaar",
  "snelle_groei",
  "veel_functies_geen_structuur",
  "negatieve_reviews_chaos",
  "verzuim_burnout_signalen",
  "nieuwe_managementlaag",
  "internationale_uitbreiding",
  // Cluster 2 — Operationeel HR
  "veel_open_vacatures",
  "langlopende_vacatures",
  "herposte_vacatures",
  "hiring_manager_actief",
  "seizoenspieken",
  "recruiter_overload",
  // Cluster 3 — Administratie
  "klein_team_in_groei",
  "geen_hr_finance_roles",
  "founder_run",
  "veel_freelancers",
  "nieuwe_bv",
  "loonadministratie_klachten",
  // Bron-specifiek
  "arbeidsrechtzaak_recent",
  "arbeidsrechtzaak_patroon",
  "arbo_boete_recent",
  "arbeidsinspectie_stillegging",
  "asbest_overtreding",
  "failliet_of_surseance",
  // Context (cluster=context, geen warmte-bijdrage)
  "bedrijfsomvang",
  "bestuursvorm",
  "sector_context",
]);
export type SignaalCategorie = z.infer<typeof SignaalCategorie>;

export const SignaalCluster = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("context"),
]);
export type SignaalCluster = z.infer<typeof SignaalCluster>;

export const SignaalBronType = z.enum([
  "website",
  "rechtspraak",
  "nla",
  "insolventie",
  "vacatures",
  "news",
]);
export type SignaalBronType = z.infer<typeof SignaalBronType>;

export const Signaal = z.object({
  categorie: SignaalCategorie,
  cluster: SignaalCluster,
  sterkte: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  observatie: z.string(),
  bewijs: z.array(z.string()).optional(),
  bronUrl: z.string().url().optional(),
  bronType: SignaalBronType,
});
export type Signaal = z.infer<typeof Signaal>;

// PAVO's 13 diensten. Cluster-toewijzing volgt Sjaak's matrix.
export const PAVO_DIENSTEN = {
  D1: { naam: "HR-beleid", cluster: 1 },
  D2: { naam: "HR-advies", cluster: 1 },
  D3: { naam: "HR-Quickscan", cluster: 1 },
  D4: { naam: "Personeelshandboek", cluster: 1 },
  D5: { naam: "Werving & Selectie", cluster: 2 },
  D6: { naam: "Ondersteuning personeelsgesprekken", cluster: 2 },
  D7: { naam: "Risico-Inventarisatie en Evaluatie", cluster: 1 },
  D8: { naam: "Functiehuis & Salarishuis", cluster: 1 },
  D9: { naam: "Gesprekscyclus personeel", cluster: 1 },
  D10: { naam: "Salarisadministratie", cluster: 3 },
  D11: { naam: "Financiële administratie", cluster: 3 },
  D12: { naam: "All-in administratie", cluster: 3 },
  D13: { naam: "Verzuimreglement", cluster: 1 },
} as const;

export type DienstCode = keyof typeof PAVO_DIENSTEN;

export type DienstMatch = {
  code: DienstCode;
  naam: string;
  prioriteit: "primair" | "secundair";
  score: number;
};

export type Warmte = "HOT" | "WARM" | "COLD";

export type LeadScoreResult = {
  warmte: Warmte;
  totaleScore: number;
  dienstenMatch: DienstMatch[];
  samenvatting: string;
};
