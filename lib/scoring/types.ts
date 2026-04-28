// PAVO-specifieke types. Leven LOKAAL (niet in @factumai/shared) omdat
// de PAVO 3-cluster framework + 13 diensten consumer-domain is, niet
// herbruikbaar tussen agents.
//
// De bestaande scoring engine in lib/scoring/index.ts werkt op een
// snake_case StoredSignal (DB-shape). Deze file definieert de
// camelCase Signaal-shape die de classificatie-laag produceert; de
// orchestrator transformeert beide.
//
// Voor dienst-namen is de DIENSTEN_MATRIX in `./diensten-matrix.ts`
// de canonical bron — daar staan de scoring-gewichten + namen die de
// UI laat zien.

import { z } from "zod";
import type { DienstCode as AdapterDienstCode } from "@/lib/adapters/types";

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

// Re-export voor backwards-compat — DienstCode is nu één union in
// lib/adapters/types.ts en de namen leven in DIENSTEN_MATRIX.
export type DienstCode = AdapterDienstCode;

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
