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
import type { DienstCode } from "@/lib/adapters/types";
import { DIENSTEN_MATRIX } from "./diensten-matrix";

export type StoredSignal = {
  categorie: string;
  cluster: number | null;
  sterkte: number;
  confidence: number;
  observatie: string;
  // ISO-8601 timestamp uit signals.detected_at. Optioneel om bestaande
  // call-sites niet te breken; ontbreken telt als "vandaag" (geen decay).
  detected_at?: string;
  bron_type?: string;
  bron_url?: string;
  bewijs?: string[];
};

// Recency-decay parameters. Een signaal van 14 dagen oud telt voor
// 1/e (~37%). Een signaal van vandaag telt voor 100%. Een failliet-
// signaal of NLA-overtreding heeft geen decay nodig (registers blijven
// feitelijk geldig); voor die categorieën geven we een vlakke factor.
const RECENCY_HALF_LIFE_DAYS = 14;
const NO_DECAY_CATEGORIES = new Set<string>([
  "failliet_of_surseance",
  "arbo_boete_recent",
  "arbeidsinspectie_stillegging",
  "asbest_overtreding",
  "arbeidsrechtzaak_patroon",
]);

function recencyFactor(sig: StoredSignal): number {
  if (!sig.detected_at) return 1;
  if (NO_DECAY_CATEGORIES.has(sig.categorie)) return 1;
  const t = new Date(sig.detected_at).getTime();
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  // Exponentieel verval; clamp ondergrens op 0.1 zodat oude signalen
  // niet volledig verdwijnen — ze tellen alleen minder mee.
  return Math.max(0.1, Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS));
}

export type LeadScoreDienst = {
  code: DienstCode;
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
  // Voor COLD leads: een korte lijst (max ~3) "waarom NIET" — welke
  // bron leverde geen signalen, welk drempel werd niet gehaald. Voor
  // HOT/WARM leeg.
  cold_redenen: string[];
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
    // Confidence × recency. Laag-vertrouwen signalen tellen minder mee,
    // oude signalen ook (zie recencyFactor). Bron-feiten zoals NLA-boetes
    // hebben geen decay — die zijn permanent geldig in registers.
    const weighted = Math.round(
      pts * (sig.confidence / 100) * recencyFactor(sig),
    );
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
  // confidence × recency, cap op 100. Diensten met score < 20 vallen weg.
  const out: LeadScoreDienst[] = [];
  for (const regel of DIENSTEN_MATRIX) {
    let score = 0;
    for (const sig of signals) {
      const g = regel.gewicht[sig.categorie];
      if (!g) continue;
      score += Math.round(g * (sig.confidence / 100) * recencyFactor(sig));
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

// ---------- waarom-NIET voor COLD leads --------------------------------
//
// Geeft een korte lijst van concrete redenen waarom de agent geen
// HR-signalen vond. Mensen zien anders alleen "geen signalen" en weten
// niet of dat betekent "alles checkte we, niets gevonden" of "we
// konden niks ophalen". Iedere reden is feitelijk en kort.

const ALL_BRON_TYPES = [
  "website",
  "vacatures",
  "rechtspraak",
  "nla",
  "insolventie",
  "news",
] as const;

function inferColdRedenen(
  profile: KvkBasisprofiel,
  signals: StoredSignal[],
  clusters: ClusterScores,
): string[] {
  const out: string[] = [];

  // 1) Welke bronnen leverden geen enkel signaal — feitelijk dichtgeknoopt.
  const seenBron = new Set(
    signals.map((s) => s.bron_type).filter((b): b is string => !!b),
  );
  const empty = ALL_BRON_TYPES.filter((b) => !seenBron.has(b));
  if (empty.length > 0 && empty.length < ALL_BRON_TYPES.length) {
    out.push(
      `Geen signalen uit ${empty.length === 1 ? "bron" : "bronnen"}: ${empty.join(", ")}.`,
    );
  }
  if (empty.length === ALL_BRON_TYPES.length) {
    out.push(
      "Geen enkele scrape-bron leverde signalen — bedrijf is publiek vrijwel onzichtbaar.",
    );
  }

  // 2) Cluster-scores te laag voor warmte-bump.
  const c = clusters;
  if (c.cluster1 < 80 && c.cluster2 < 60 && c.cluster3 < 40) {
    const peak = Math.max(c.cluster1, c.cluster2, c.cluster3);
    out.push(
      `Hoogste cluster-score is ${peak}/100 — onder drempel voor WARM (60) of HOT (80).`,
    );
  }

  // 3) FTE-bucket te laag of onbekend.
  if (!profile.fteKlasse) {
    out.push("FTE-klasse niet beschikbaar in KvK-data — geen size-context.");
  } else if (fteUpperBound(profile.fteKlasse) < 10) {
    out.push("Bedrijf onder 10 FTE — meestal nog buiten PAVO-doelgroep.");
  }

  // 4) Inactief.
  if (profile.actief === false) {
    out.push("Bedrijf staat als inactief geregistreerd in KvK.");
  }

  // 5) Geen website → geen scrape mogelijk.
  if (!profile.websiteUrl) {
    out.push("Geen bedrijfswebsite bekend — vacatures + content niet te scrapen.");
  }

  return out.slice(0, 4);
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
  const cold_redenen =
    warmte === "COLD" ? inferColdRedenen(profile, signals, clusters) : [];

  return {
    kvk: profile.kvkNummer,
    warmte,
    warmte_reden: reden,
    diensten_match: diensten,
    totale_score: totale,
    samenvatting,
    archetype,
    cold_redenen,
  };
}
