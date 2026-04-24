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
  DienstCode,
  FteKlasse,
  Lead,
  LeadSource,
  SearchFilters,
  SearchResult,
} from "@/lib/adapters/types";
import { kvkGetBasisprofiel, kvkZoekBedrijven } from "@/lib/kvk/client";
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
const MAX_PARALLEL_SCRAPES = 5;

export class ProductionLeadSource implements LeadSource {
  async runSearch(filters: SearchFilters): Promise<SearchResult> {
    const startedAt = Date.now();
    const supabase = supabaseServer();
    const budgetUsd = Number(
      process.env.MAX_COST_PER_SEARCH_USD ?? DEFAULT_BUDGET_USD,
    );

    // ---- Stap 1: KvK-afbakening ------------------------------------
    const sbiCodes = mapBrancheToSbi(filters.branche);
    const provincies = filters.regio_center
      ? provincesWithinRadius(filters.regio_center, filters.regio_straal_km)
      : undefined;
    const candidates = await kvkZoekBedrijven({
      sbiCodes,
      provincies,
      limit: 200,
    });

    // ---- Stap 2: per bedrijf basisprofiel ophalen (FTE + coords) ---
    const profiles = await Promise.all(
      candidates.map((c) => kvkGetBasisprofiel(c.kvkNummer).catch(() => null)),
    );
    const enriched = candidates
      .map((c, i) => ({ candidate: c, profile: profiles[i] }))
      .filter((x): x is { candidate: typeof candidates[0]; profile: KvkBasisprofiel } => !!x.profile);

    // FTE post-filter — KvK's zoeken biedt geen directe filter hierop.
    const fteFiltered = enriched.filter(({ profile }) => {
      if (!filters.fte_klassen.length) return true;
      return profile.fteKlasse && filters.fte_klassen.includes(profile.fteKlasse as FteKlasse);
    });

    // ---- Stap 3: geo-filter op haversine-afstand --------------------
    const geoFiltered = await applyGeoFilter(
      fteFiltered,
      filters.regio_center,
      filters.regio_straal_km,
    );

    // ---- Stap 4: upsert companies + trigger snapshot ----------------
    await upsertCompanies(supabase, geoFiltered);

    // ---- Stap 5: decide who to (re-)scrape + budget-check -----------
    const toScrape = await determineScrapeTargets(
      supabase,
      geoFiltered.map((x) => x.profile.kvkNummer),
    );
    let totalCostUsd = 0;

    // ---- Stap 6: parallel scrapen met concurrency-limiet -----------
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
    });

    // ---- Stap 7: scoren per bedrijf ---------------------------------
    const leads: Lead[] = [];
    for (const { profile } of geoFiltered) {
      const { data: signals } = await supabase
        .from("signals")
        .select("*")
        .eq("kvk", profile.kvkNummer)
        .gte(
          "detected_at",
          new Date(Date.now() - CACHE_TTL_DAYS * 86_400_000).toISOString(),
        );
      const score = scoreCompany(profile, signals ?? []);
      leads.push(scoreToLead(profile, score));
    }

    // ---- Stap 8: log search_query + return --------------------------
    await supabase.from("search_queries").insert({
      filters: filters as unknown as object,
      total_candidates: candidates.length,
      total_scraped: toScrape.length,
      total_leads_returned: leads.length,
      total_cost_usd: totalCostUsd,
      duration_ms: Date.now() - startedAt,
    });

    const sorted = sortLeadsByWarmte(leads);
    return {
      search_id: `prod-${Date.now()}`,
      titel: `Live resultaten · ${filters.branche}`,
      leads: sorted,
      relaxation: { regio: false, fte: false },
    };
  }

  async getLead(kvk: string): Promise<Lead | null> {
    const supabase = supabaseServer();
    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("kvk", kvk)
      .maybeSingle();
    if (!company) return null;
    const { data: signals } = await supabase
      .from("signals")
      .select("*")
      .eq("kvk", kvk)
      .gte(
        "detected_at",
        new Date(Date.now() - CACHE_TTL_DAYS * 86_400_000).toISOString(),
      );
    const profile = await kvkGetBasisprofiel(kvk).catch(() => null);
    if (!profile) return null;
    const score = scoreCompany(profile, signals ?? []);
    return scoreToLead(profile, score);
  }
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

function scoreToLead(
  profile: KvkBasisprofiel,
  score: ReturnType<typeof scoreCompany>,
): Lead {
  const fteKlasse = (profile.fteKlasse ?? bucketFte(undefined) ?? "10-19") as FteKlasse;
  return {
    id: profile.kvkNummer,
    naam: profile.naam,
    kvk: profile.kvkNummer,
    plaats: profile.plaats ?? "",
    provincie: profile.provincie ?? "",
    sector: profile.sbiCodes[0] ?? "",
    fte_klasse: fteKlasse,
    warmte: score.warmte,
    archetype: null,
    signalen: [],
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
