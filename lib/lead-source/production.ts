// Productie-implementatie van LeadSource. Volgt de flow uit de briefing:
//
//   1. KvK-afbakening (SBI + provincies + FTE) via lib/kvk
//   2. Geo-filter via PDOK + haversine
//   3. Upsert naar companies + kvk_snapshots
//   4. Bepaal welke bedrijven herscrapet moeten worden (cache > 30 dagen)
//   5. Parallel scrape via orchestrator (max 5 tegelijk)
//   6. Score via scoring-engine
//   7. Log search_query, return in LeadSource-formaat
//
// Budget-limiet: MAX_COST_PER_SEARCH_USD stopt de run bij overschrijding.

import type {
  Bron,
  DienstCode,
  FteKlasse,
  GetLeadOptions,
  Lead,
  LeadSource,
  RunSearchOptions,
  SearchFilters,
  SearchProgressEvent,
  SearchResult,
  Signaal,
} from "@/lib/adapters/types";
import { kvkGetBasisprofiel, kvkSnapshotAndStore, kvkZoekBedrijven } from "@/lib/kvk/client";
import { mapBrancheToSbi } from "@/lib/kvk/sbi-mapping";
import { bucketFte, type KvkBasisprofiel } from "@/lib/kvk/types";
import {
  haversineKm,
  pdokGeocodePlaats,
  provincesWithinRadius,
  type LatLng,
} from "@/lib/geo/pdok";
import { supabaseServer } from "@/lib/supabase/client";
import { runScrapersForCompany } from "@/lib/orchestrator";
import { scoreCompany } from "@/lib/scoring";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_BUDGET_USD = 5;
const CACHE_TTL_DAYS = 30;
const LEAD_DETAIL_TTL_DAYS = 7;
const SNAPSHOT_TTL_DAYS = 7;
const MAX_PARALLEL_SCRAPES = 5;

function noopEmit(_event: SearchProgressEvent): void {
  // default no-op; callers that don't care get zero overhead.
}

export class ProductionLeadSource implements LeadSource {
  async runSearch(
    filters: SearchFilters,
    opts: RunSearchOptions = {},
  ): Promise<SearchResult> {
    const emit = opts.onEvent ?? noopEmit;
    const startedAt = Date.now();
    const supabase = supabaseServer();
    const budgetUsd = Number(
      process.env.MAX_COST_PER_SEARCH_USD ?? DEFAULT_BUDGET_USD,
    );

    emit({ type: "stage", stage: "kvk", message: "Kamer van Koophandel doorzoeken…" });
    const sbiCodes = mapBrancheToSbi(filters.branche);
    const provincies = filters.regio_center
      ? provincesWithinRadius(filters.regio_center, filters.regio_straal_km)
      : undefined;
    const candidates = await kvkZoekBedrijven({
      sbiCodes,
      provincies,
      limit: 200,
    });
    emit({ type: "kvk", totalCandidates: candidates.length });

    emit({
      type: "stage",
      stage: "basisprofielen",
      message: `Basisprofielen ophalen (${candidates.length})…`,
    });
    const profiles = await Promise.all(
      candidates.map((c) => kvkGetBasisprofiel(c.kvkNummer).catch(() => null)),
    );
    const enriched = candidates
      .map((c, i) => ({ candidate: c, profile: profiles[i] }))
      .filter(
        (x): x is { candidate: typeof candidates[0]; profile: KvkBasisprofiel } =>
          !!x.profile,
      );

    const fteFiltered = enriched.filter(({ profile }) => {
      if (!filters.fte_klassen.length) return true;
      return (
        profile.fteKlasse &&
        filters.fte_klassen.includes(profile.fteKlasse as FteKlasse)
      );
    });

    emit({
      type: "stage",
      stage: "geo",
      message: "Regio-filter toepassen…",
    });
    const geoFiltered = await applyGeoFilter(
      fteFiltered,
      filters.regio_center,
      filters.regio_straal_km,
    );
    emit({ type: "geo", remaining: geoFiltered.length });

    await upsertCompanies(supabase, geoFiltered);
    // Snapshot nieuwe / stale bedrijven in kvk_snapshots — doen we na de
    // upsert zodat de FK naar companies vastligt. Fouten logt de helper
    // zelf; we stoppen de flow niet.
    await snapshotNewOrStale(supabase, geoFiltered);

    const toScrape = opts.refresh
      ? geoFiltered.map((x) => x.profile.kvkNummer)
      : await determineScrapeTargets(
          supabase,
          geoFiltered.map((x) => x.profile.kvkNummer),
        );
    let totalCostUsd = 0;

    emit({
      type: "stage",
      stage: "scrape",
      message: `Bedrijfssignalen ophalen (${toScrape.length} nieuw/stale)…`,
    });
    let scraped = 0;
    await runInBatches(toScrape, MAX_PARALLEL_SCRAPES, async (kvk) => {
      if (totalCostUsd >= budgetUsd) return;
      const prof = geoFiltered.find((x) => x.profile.kvkNummer === kvk)?.profile;
      if (!prof) return;
      const cost = await runScrapersForCompany(
        {
          kvk: prof.kvkNummer,
          naam: prof.naam,
          websiteUrl: prof.websiteUrl,
          zoeknamen: [prof.naam, prof.handelsnaam].filter(
            (s): s is string => !!s,
          ),
        },
        supabase,
      );
      totalCostUsd += cost;
      scraped += 1;
      emit({
        type: "scrape",
        kvk: prof.kvkNummer,
        naam: prof.naam,
        scraped,
        total: toScrape.length,
        costUsd: totalCostUsd,
      });
    });

    emit({
      type: "stage",
      stage: "score",
      message: "Scoren + warmte bepalen…",
    });
    const leads: Lead[] = [];
    let scored = 0;
    for (const { profile } of geoFiltered) {
      const signals = await fetchRecentSignals(
        supabase,
        profile.kvkNummer,
        CACHE_TTL_DAYS,
      );
      const score = scoreCompany(profile, signals.map(toScoringSignal));
      leads.push(scoreToLead(profile, score, signals));
      scored += 1;
      emit({ type: "score", scored, total: geoFiltered.length });
    }

    await supabase.from("search_queries").insert({
      filters: filters as unknown as object,
      total_candidates: candidates.length,
      total_scraped: toScrape.length,
      total_leads_returned: leads.length,
      total_cost_usd: totalCostUsd,
      duration_ms: Date.now() - startedAt,
    });

    const sorted = sortLeadsByWarmte(leads);
    const durationMs = Date.now() - startedAt;
    emit({
      type: "done",
      totalLeadsReturned: sorted.length,
      totalCostUsd,
      durationMs,
    });
    return {
      search_id: `prod-${Date.now()}`,
      titel: `Live resultaten · ${filters.branche}`,
      leads: sorted,
      relaxation: { regio: false, fte: false },
    };
  }

  async getLead(kvk: string, opts: GetLeadOptions = {}): Promise<Lead | null> {
    const supabase = supabaseServer();
    const { data: company } = await supabase
      .from("companies")
      .select("kvk")
      .eq("kvk", kvk)
      .maybeSingle();
    if (!company) return null;

    // Detail-TTL (7 dagen) is korter dan search-TTL (30 dagen) — als een
    // consultant inzoomt op een lead willen we relatief verse data.
    const profile = await kvkGetBasisprofiel(kvk, {
      bypassCache: opts.refresh === true,
    }).catch(() => null);
    if (!profile) return null;

    const needsRefresh =
      opts.refresh || (await isScrapeStale(supabase, kvk, LEAD_DETAIL_TTL_DAYS));
    if (needsRefresh) {
      await runScrapersForCompany(
        {
          kvk: profile.kvkNummer,
          naam: profile.naam,
          websiteUrl: profile.websiteUrl,
          zoeknamen: [profile.naam, profile.handelsnaam].filter(
            (s): s is string => !!s,
          ),
        },
        supabase,
      );
    }

    const signals = await fetchRecentSignals(supabase, kvk, CACHE_TTL_DAYS);
    const score = scoreCompany(profile, signals.map(toScoringSignal));
    return scoreToLead(profile, score, signals);
  }
}

// De rows uit Supabase kunnen NULL-velden hebben die scoring niet kent.
// We mappen hier naar de smallere shape die scoreCompany verwacht.
function toScoringSignal(row: StoredSignalRow) {
  return {
    categorie: row.categorie,
    cluster: row.cluster,
    sterkte: row.sterkte,
    confidence: row.confidence,
    observatie: row.observatie,
    bron_type: row.bron_type ?? undefined,
    bron_url: row.bron_url ?? undefined,
    bewijs: row.bewijs ?? undefined,
  };
}

// ---------- helpers -------------------------------------------------------

async function applyGeoFilter<T extends { profile: KvkBasisprofiel }>(
  enriched: T[],
  center: LatLng | null,
  radiusKm: number,
): Promise<T[]> {
  if (!center) return enriched;
  // Geocode elke unieke plaats in de result-set één keer.
  const uniquePlaatsen = [
    ...new Set(
      enriched
        .map((x) => x.profile.plaats)
        .filter((p): p is string => !!p),
    ),
  ];
  const coordsMap = new Map<string, LatLng | null>();
  await Promise.all(
    uniquePlaatsen.map(async (p) => {
      coordsMap.set(p, await pdokGeocodePlaats(p));
    }),
  );
  return enriched.filter(({ profile }) => {
    if (!profile.plaats) return true; // niet filteren als we geen plaats weten
    const coords = coordsMap.get(profile.plaats);
    if (!coords) return true;
    return haversineKm(center, coords) <= radiusKm;
  });
}

async function upsertCompanies<T extends { profile: KvkBasisprofiel }>(
  supabase: SupabaseClient,
  enriched: T[],
): Promise<void> {
  if (enriched.length === 0) return;
  const rows = enriched.map(({ profile }) => ({
    kvk: profile.kvkNummer,
    naam: profile.naam,
    handelsnaam: profile.handelsnaam,
    website_url: profile.websiteUrl,
    sbi_codes: profile.sbiCodes,
    fte_klasse: profile.fteKlasse,
    plaats: profile.plaats,
    provincie: profile.provincie,
    bestuursvorm: profile.bestuursvorm,
    oprichtingsdatum: profile.oprichtingsdatum,
    actief: profile.actief,
    last_updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("companies")
    .upsert(rows, { onConflict: "kvk" });
  if (error) console.warn(`companies upsert: ${error.message}`);
}

async function determineScrapeTargets(
  supabase: SupabaseClient,
  kvks: string[],
): Promise<string[]> {
  if (kvks.length === 0) return [];
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("scrape_runs")
    .select("kvk, completed_at, success")
    .in("kvk", kvks)
    .eq("success", true)
    .gte("completed_at", cutoff);
  const recentlyScraped = new Set((data ?? []).map((r) => r.kvk as string));
  return kvks.filter((k) => !recentlyScraped.has(k));
}

async function isScrapeStale(
  supabase: SupabaseClient,
  kvk: string,
  ttlDays: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const { count } = await supabase
    .from("scrape_runs")
    .select("id", { count: "exact", head: true })
    .eq("kvk", kvk)
    .eq("success", true)
    .gte("completed_at", cutoff);
  return (count ?? 0) === 0;
}

async function fetchRecentSignals(
  supabase: SupabaseClient,
  kvk: string,
  ttlDays: number,
): Promise<StoredSignalRow[]> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("signals")
    .select("categorie, cluster, sterkte, confidence, observatie, bron_type, bron_url, bewijs")
    .eq("kvk", kvk)
    .gte("detected_at", cutoff);
  return (data ?? []) as StoredSignalRow[];
}

async function snapshotNewOrStale<T extends { profile: KvkBasisprofiel }>(
  supabase: SupabaseClient,
  enriched: T[],
): Promise<void> {
  if (enriched.length === 0) return;
  const kvks = enriched.map((x) => x.profile.kvkNummer);
  const cutoff = new Date(Date.now() - SNAPSHOT_TTL_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("kvk_snapshots")
    .select("kvk, snapshot_at")
    .in("kvk", kvks)
    .gte("snapshot_at", cutoff);
  const hasRecent = new Set((data ?? []).map((r) => r.kvk as string));
  const needed = enriched.filter((x) => !hasRecent.has(x.profile.kvkNummer));
  // Niet parallel — KvK-rate-limiter cap't 'em al en we willen snapshots
  // niet tegen elkaar laten uitvechten.
  for (const { profile } of needed) {
    try {
      await kvkSnapshotAndStore(profile.kvkNummer, supabase);
    } catch (err) {
      console.warn(`snapshot faalde voor ${profile.kvkNummer}: ${String(err)}`);
    }
  }
}

async function runInBatches<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

// Scraper-`bron_type` strings → de vaste Bron-union die de UI kent. Signalen
// die van een onbekende bron komen vallen terug op "Nieuws" (zachte bron)
// zodat de bronSterkte-helper ze als interpretatief behandelt.
const BRON_TYPE_TO_BRON: Record<string, Bron> = {
  website: "bedrijfswebsite",
  rechtspraak: "Rechtspraak.nl",
  nla: "NLA",
  insolventie: "Insolventieregister",
  news: "Nieuws",
  vacatures: "Jobdigger",
};

function toLeadSignaal(row: StoredSignalRow): Signaal {
  const bron = BRON_TYPE_TO_BRON[row.bron_type ?? ""] ?? "Nieuws";
  return { tekst: row.observatie, bron };
}

type StoredSignalRow = {
  categorie: string;
  cluster: number | null;
  sterkte: number;
  confidence: number;
  observatie: string;
  bron_type?: string | null;
  bron_url?: string | null;
  bewijs?: string[] | null;
};

function scoreToLead(
  profile: KvkBasisprofiel,
  score: ReturnType<typeof scoreCompany>,
  signals: StoredSignalRow[],
): Lead {
  const fteKlasse = (profile.fteKlasse ?? bucketFte(undefined) ?? "10-19") as FteKlasse;
  // Dedupe signalen op (categorie, bron_type) — meerdere scrape-runs
  // kunnen dezelfde categorie oppikken; we tonen 'm één keer aan Roy.
  const seen = new Set<string>();
  const dedupedSignalen: Signaal[] = [];
  for (const s of signals) {
    const k = `${s.categorie}|${s.bron_type ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedSignalen.push(toLeadSignaal(s));
  }
  return {
    id: profile.kvkNummer,
    naam: profile.naam,
    kvk: profile.kvkNummer,
    plaats: profile.plaats ?? "",
    provincie: profile.provincie ?? "",
    sector: profile.sbiCodes[0] ?? "",
    fte_klasse: fteKlasse,
    warmte: score.warmte,
    archetype: score.archetype,
    signalen: dedupedSignalen,
    // Scoring engine werkt met string-codes; we casten terug naar
    // DienstCode omdat de matrix alleen D1-D8 (de huidige UI-set)
    // produceert. Als we D9-D13 toevoegen, update ook de type-union.
    diensten: score.diensten_match.map((d) => ({
      code: d.code as DienstCode,
      naam: d.naam,
      prioriteit: d.prioriteit,
      score: d.score,
    })),
    observatie: score.samenvatting,
  };
}

function sortLeadsByWarmte(leads: Lead[]): Lead[] {
  const rank = { HOT: 0, WARM: 1, COLD: 2 } as const;
  return [...leads].sort((a, b) => rank[a.warmte] - rank[b.warmte]);
}
