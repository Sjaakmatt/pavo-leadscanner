// Scoring engine. Neemt een KvK-basisprofiel + alle actuele signalen en
// levert een LeadScore op (warmte + dienstmatches + samenvatting).
//
// Regels komen 1-op-1 uit Sjaak's briefing:
//   Cluster 1 (HR-structuur) — HOT 80-100
//   Cluster 2 (Operationeel HR) — WARM 60-85
//   Cluster 3 (Administratie) — 40-70
//   Combinatie-bonussen — force HOT/WARM + minimum-score
//
// De output shape is compatible met lib/adapters/types::Lead zodat de
// UI identiek gebruik kan maken van demo of prod leads.

import type { KvkBasisprofiel } from "@/lib/kvk/types";
import { DIENSTEN_MATRIX } from "./diensten-matrix";

export type StoredSignal = {
  categorie: string;
  cluster: number | null;
  sterkte: number;
  confidence: number;
  observatie: string;
  bron_type?: string;
  bron_url?: string;
  bewijs?: string[];
};

export type LeadScoreDienst = {
  code: string;
  naam: string;
  prioriteit: "primair" | "secundair";
  score: number;
};

export type LeadScore = {
  kvk: string;
  warmte: "HOT" | "WARM" | "COLD";
  warmte_reden: string;
  diensten_match: LeadScoreDienst[];
  totale_score: number;
  samenvatting: string;
  archetype: {
    code: "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8";
    naam: string;
    beschrijving: string;
  } | null;
};

// ---------- cluster-scoring ----------------------------------------------

// Per-signaal score-bijdragen uit de briefing. Niet alle categorieën
// leveren een punt-bijdrage (een failliet_of_surseance is bv. een
// uitsluiter, niet een warmte-driver).
const CLUSTER_POINTS: Record<string, number> = {
  // Cluster 1
  geen_hr_rol_zichtbaar: 30,
  snelle_groei: 20,
  veel_functies_geen_structuur: 20,
  internationale_uitbreiding: 15,
  nieuwe_managementlaag: 20,
  verzuim_burnout_signalen: 30,
  negatieve_reviews_chaos: 25,
  arbeidsrechtzaak_recent: 20,
  arbeidsrechtzaak_patroon: 30,
  arbo_boete_recent: 35,
  arbeidsinspectie_stillegging: 40,
  asbest_overtreding: 25,
  // Cluster 2
  veel_open_vacatures: 25,
  langlopende_vacatures: 20,
  herposte_vacatures: 30,
  hiring_manager_actief: 15,
  recruiter_overload: 15,
  seizoenspieken: 15,
  // Cluster 3
  founder_run: 20,
  klein_team_in_groei: 15,
  nieuwe_bv: 15,
  geen_hr_finance_roles: 25,
  veel_freelancers: 15,
  loonadministratie_klachten: 20,
};

type ClusterScores = {
  cluster1: number;
  cluster2: number;
  cluster3: number;
  contextFlags: Set<string>;
  categorieen: Set<string>;
};

function scoreByClusters(signals: StoredSignal[]): ClusterScores {
  const s: ClusterScores = {
    cluster1: 0,
    cluster2: 0,
    cluster3: 0,
    contextFlags: new Set(),
    categorieen: new Set(),
  };
  for (const sig of signals) {
    s.categorieen.add(sig.categorie);
    if (sig.cluster === null) s.contextFlags.add(sig.categorie);
    const pts = CLUSTER_POINTS[sig.categorie] ?? 0;
    // Confidence-gewogen — laag-vertrouwen signalen tellen minder mee.
    const weighted = Math.round(pts * (sig.confidence / 100));
    if (sig.cluster === 1) s.cluster1 += weighted;
    if (sig.cluster === 2) s.cluster2 += weighted;
    if (sig.cluster === 3) s.cluster3 += weighted;
  }
  s.cluster1 = Math.min(100, s.cluster1);
  s.cluster2 = Math.min(100, s.cluster2);
  s.cluster3 = Math.min(100, s.cluster3);
  return s;
}

// ---------- FTE-klasse als numeric upper-bound ---------------------------

function fteUpperBound(fteKlasse?: string | null): number {
  if (!fteKlasse) return 0;
  if (fteKlasse.startsWith(">")) return 999;
  const match = fteKlasse.match(/(\d+)(?:-(\d+))?/);
  if (!match) return 0;
  return match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10);
}

function fteLowerBound(fteKlasse?: string | null): number {
  if (!fteKlasse) return 0;
  const match = fteKlasse.match(/(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

// ---------- combinatie-bonussen -----------------------------------------

type Override = { warmte: "HOT" | "WARM" | "COLD"; minScore: number; reden: string };

function combinationOverride(
  profile: KvkBasisprofiel,
  categorieen: Set<string>,
  signals: StoredSignal[],
): Override | null {
  const fteUpper = fteUpperBound(profile.fteKlasse);
  const fteLower = fteLowerBound(profile.fteKlasse);
  const vacancyCount = signals.filter((s) => s.categorie === "veel_open_vacatures").length;

  // 12+ vacatures + geen HR + groei → HOT + 95
  if (
    vacancyCount >= 1 &&
    signals.some((s) => s.categorie === "veel_open_vacatures" && s.sterkte >= 80) &&
    categorieen.has("geen_hr_rol_zichtbaar") &&
    categorieen.has("snelle_groei")
  ) {
    return {
      warmte: "HOT",
      minScore: 95,
      reden: "12+ openstaande vacatures zonder zichtbare HR-rol en in groeifase — classieke A1/A4-signatuur.",
    };
  }

  // 5+ vacatures >45d + reposts + negatieve reviews → HOT + 90
  if (
    categorieen.has("langlopende_vacatures") &&
    categorieen.has("herposte_vacatures") &&
    categorieen.has("negatieve_reviews_chaos")
  ) {
    return {
      warmte: "HOT",
      minScore: 90,
      reden: "Langlopende + herposte vacatures gecombineerd met chaos-signalen — draaideur-patroon (A3).",
    };
  }

  // 15→25 FTE + geen HR/finance + founder → WARM + 75
  if (
    fteLower >= 10 &&
    fteUpper <= 49 &&
    categorieen.has("founder_run") &&
    categorieen.has("geen_hr_finance_roles")
  ) {
    return {
      warmte: "WARM",
      minScore: 75,
      reden: "MKB in groeispurt zonder interne HR/finance, nog founder-gedreven — A5 (familie-MKB professionaliseert).",
    };
  }

  // Uitsluit: failliet / surseance → COLD met min-score 0
  if (categorieen.has("failliet_of_surseance")) {
    return {
      warmte: "COLD",
      minScore: 0,
      reden: "Actief faillissement of surseance — uitgesloten als lead.",
    };
  }

  return null;
}

// ---------- warmte-afleiding --------------------------------------------

function deriveWarmte(
  profile: KvkBasisprofiel,
  clusters: ClusterScores,
): { warmte: "HOT" | "WARM" | "COLD"; reden: string; totale: number } {
  const fteUpper = fteUpperBound(profile.fteKlasse);
  // Extra boost: geen_hr + FTE > 30 → +10
  let cluster1Adj = clusters.cluster1;
  if (clusters.categorieen.has("geen_hr_rol_zichtbaar") && fteUpper >= 30) {
    cluster1Adj = Math.min(100, cluster1Adj + 10);
  }

  if (cluster1Adj >= 80) {
    return {
      warmte: "HOT",
      reden: `Sterke cluster-1 signalen (${cluster1Adj}/100) — HR-structuur onder druk.`,
      totale: cluster1Adj,
    };
  }
  if (clusters.cluster2 >= 60) {
    return {
      warmte: "WARM",
      reden: `Operationele HR-druk (cluster 2: ${clusters.cluster2}/100).`,
      totale: Math.max(clusters.cluster2, cluster1Adj),
    };
  }
  if (clusters.cluster3 >= 40) {
    return {
      warmte: "WARM",
      reden: `Administratieve belasting in beeld (cluster 3: ${clusters.cluster3}/100).`,
      totale: Math.max(clusters.cluster3, cluster1Adj, clusters.cluster2),
    };
  }
  return {
    warmte: "COLD",
    reden: "Geen sterke signalen gedetecteerd in de laatste 30 dagen.",
    totale: Math.max(cluster1Adj, clusters.cluster2, clusters.cluster3),
  };
}

// ---------- dienst-matching --------------------------------------------

function matchDiensten(signals: StoredSignal[]): LeadScoreDienst[] {
  // Per dienst: som de gewichten van aangetroffen signalen, weeg met
  // confidence, cap op 100. Diensten met score < 20 vallen weg.
  const out: LeadScoreDienst[] = [];
  for (const regel of DIENSTEN_MATRIX) {
    let score = 0;
    for (const sig of signals) {
      const g = regel.gewicht[sig.categorie];
      if (!g) continue;
      score += Math.round(g * (sig.confidence / 100));
    }
    if (score < 20) continue;
    score = Math.min(100, score);
    out.push({
      code: regel.code,
      naam: regel.naam,
      prioriteit: score >= 60 ? "primair" : "secundair",
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ---------- samenvatting -----------------------------------------------

function buildSamenvatting(
  profile: KvkBasisprofiel,
  warmte: "HOT" | "WARM" | "COLD",
  reden: string,
  diensten: LeadScoreDienst[],
): string {
  const dienstDeel =
    diensten.length > 0
      ? `Sterkste dienst-match: ${diensten[0].naam} (score ${diensten[0].score}).`
      : "Nog geen duidelijke dienst-match op basis van actuele signalen.";
  return `${profile.naam} — ${warmte}. ${reden} ${dienstDeel}`;
}

// ---------- archetype-afleiding ----------------------------------------

// De 8 PAVO-archetypes (zie data/leads.json meta.archetype_beschrijvingen).
// We kiezen het best-passende archetype op basis van de signaal-signature;
// als er geen duidelijke match is geven we null terug en laat de UI het
// archetype-blok weg.
const ARCHETYPES = {
  A1: {
    naam: "Scale-up hits HR wall",
    beschrijving:
      "Snelle groei heeft het bedrijf voorbij het punt gedragen waar informele HR-afspraken volstaan. Professionalisering is noodzakelijk maar nog niet ingezet.",
  },
  A2: {
    naam: "50-FTE drempel gepasseerd",
    beschrijving:
      "Bedrijf heeft recent de wettelijke drempel van 50 medewerkers overschreden, wat nieuwe verplichtingen activeert op OR-instelling, verzuimrapportage en arbo-beleid.",
  },
  A3: {
    naam: "Draaideur in operations",
    beschrijving:
      "Dezelfde functie wordt herhaaldelijk opnieuw ingevuld binnen korte tijd. Wijst op structureel probleem in werving, leidinggeven of arbeidsvoorwaarden.",
  },
  A4: {
    naam: "Werf-wanhoop in krappe branche",
    beschrijving:
      "Bedrijf toont meerdere signalen van structurele wervingsproblemen gecombineerd met gebrek aan HR-capaciteit om dit strategisch aan te pakken.",
  },
  A5: {
    naam: "Familie-MKB professionaliseert",
    beschrijving:
      "Generatie-wissel of opvolging is gaande. Kantelpunt waarop informele familie-afspraken gedocumenteerd en formeel gemaakt moeten worden.",
  },
  A6: {
    naam: "Post-overname HR-chaos",
    beschrijving:
      "Recente overname creëert integratie-vraagstukken rond arbeidsvoorwaarden-harmonisatie, management-structuur en culturele afstemming.",
  },
  A7: {
    naam: "Seizoenspieken zonder flex-laag",
    beschrijving:
      "Structureel seizoenspatroon wordt ad-hoc opgevangen zonder strategische flex-strategie. Inefficiënt en duur op langere termijn.",
  },
  A8: {
    naam: "Verzuim-spiraal in fysieke sector",
    beschrijving:
      "Verhoogd verzuimpercentage in combinatie met fysiek belastende sector. Vaak verweven met leiderschap-kwaliteit en werk-inrichting.",
  },
} as const;

function inferArchetype(
  profile: KvkBasisprofiel,
  categorieen: Set<string>,
): LeadScore["archetype"] {
  const fteLower = fteLowerBound(profile.fteKlasse);
  const fteUpper = fteUpperBound(profile.fteKlasse);
  const has = (c: string) => categorieen.has(c);

  // Volgorde is prioriteit: sterkere combinaties eerst zodat we niet per
  // ongeluk een zwakker archetype kiezen als meerdere matchen.

  // A1 — scale-up overshoot: groei + FTE door de 30+ heen + HR ontbreekt
  if (has("snelle_groei") && fteUpper >= 30 && has("geen_hr_rol_zichtbaar")) {
    return { code: "A1", ...ARCHETYPES.A1 };
  }
  // A4 — werf-wanhoop
  if (
    (has("veel_open_vacatures") || has("langlopende_vacatures")) &&
    has("herposte_vacatures")
  ) {
    return { code: "A4", ...ARCHETYPES.A4 };
  }
  // A3 — draaideur: reposts + negatieve-reviews/verloop
  if (has("herposte_vacatures") && has("negatieve_reviews_chaos")) {
    return { code: "A3", ...ARCHETYPES.A3 };
  }
  // A8 — verzuim-spiraal, vooral in bouw/productie (SBI 10-33/41-43)
  const sbi = profile.sbiCodes[0]?.slice(0, 2) ?? "";
  const fysiek = ["41", "42", "43", "10", "11", "12", "13", "14", "15",
    "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26",
    "27", "28", "29", "30", "31", "32", "33"].includes(sbi);
  if (has("verzuim_burnout_signalen") && fysiek) {
    return { code: "A8", ...ARCHETYPES.A8 };
  }
  // A2 — 50-FTE-drempel: recent over 50 heen + groei
  if (fteLower >= 50 && fteUpper <= 99 && has("snelle_groei")) {
    return { code: "A2", ...ARCHETYPES.A2 };
  }
  // A5 — familie-MKB: founder-run + groei
  if (has("founder_run") && (has("snelle_groei") || has("klein_team_in_groei"))) {
    return { code: "A5", ...ARCHETYPES.A5 };
  }
  // A6 — post-overname: nieuwe managementlaag + internationale uitbreiding
  if (has("nieuwe_managementlaag") && has("internationale_uitbreiding")) {
    return { code: "A6", ...ARCHETYPES.A6 };
  }
  // A7 — seizoenspieken
  if (has("seizoenspieken")) {
    return { code: "A7", ...ARCHETYPES.A7 };
  }
  return null;
}

// ---------- public API -------------------------------------------------

export function scoreCompany(
  profile: KvkBasisprofiel,
  signals: StoredSignal[],
): LeadScore {
  const clusters = scoreByClusters(signals);
  const override = combinationOverride(profile, clusters.categorieen, signals);
  const derived = deriveWarmte(profile, clusters);

  const warmte = override?.warmte ?? derived.warmte;
  const totale = override ? Math.max(derived.totale, override.minScore) : derived.totale;
  const reden = override?.reden ?? derived.reden;

  const diensten = matchDiensten(signals);
  const archetype = inferArchetype(profile, clusters.categorieen);
  const samenvatting = buildSamenvatting(profile, warmte, reden, diensten);

  return {
    kvk: profile.kvkNummer,
    warmte,
    warmte_reden: reden,
    diensten_match: diensten,
    totale_score: totale,
    samenvatting,
    archetype,
  };
}
