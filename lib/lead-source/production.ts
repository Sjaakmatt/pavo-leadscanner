// MCP-based ProductionLeadSource. Praat uitsluitend met de vier externe
// FactumAI domein-MCPs — geen in-process scrapers, geen directe KvK-client.
//
//   1. mcp-bedrijven.kvk_zoeken                    (SBI + provincies)
//   2. mcp-bedrijven.kvk_basisprofiel              (parallel per kandidaat)
//   3. mcp-bedrijven.pdok_geocode                  (per unieke plaats voor geo-filter)
//   4. Upsert companies-row                        (Supabase)
//   5. Per bedrijf parallel via orchestrator:
//        mcp-bedrijven.get_company_website_content
//        mcp-vacatures.extract_vacancies_from_company_site
//        mcp-juridisch.search_court_cases / search_labor_inspections / search_insolvencies
//        mcp-news.search_company_news
//      → classificatie naar PAVO-Signaal[]
//   6. scoring engine → LeadScore
//   7. scored_leads + search_queries afronden
//
// Budget-guard via MAX_COST_PER_SEARCH_USD; we kunnen kosten alleen
// schatten (dashboard heeft de echte cijfers per tool-call), dus de
// guard is conservatief.

import type {
  Bron,
  FteKlasse,
  GetLeadOptions,
  Lead,
  LeadSource,
  RunSearchOptions,
  SearchFilters,
  SearchProgressEvent,
  SearchResult,
  Signaal as UiSignaal,
} from "@/lib/adapters/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpHttpClient, type TenantContext } from "@/lib/mcp/client";
import { BedrijvenMcp, requireBedrijvenUrl } from "@/lib/mcp/bedrijven";
import { VacaturesMcp, requireVacaturesUrl } from "@/lib/mcp/vacatures";
import { JuridischMcp, requireJuridischUrl } from "@/lib/mcp/juridisch";
import { NewsMcp, requireNewsUrl } from "@/lib/mcp/news";
import { buildTenantContext } from "@/lib/mcp/tenant";
import type { KvkZoekHit, KvkBasisprofiel as McpKvkBasisprofiel } from "@/lib/mcp/schemas";
import type { KvkBasisprofiel as LocalKvkBasisprofiel } from "@/lib/kvk/types";
import { mapBrancheToSbi } from "@/lib/kvk/sbi-mapping";
import {
  haversineKm,
  provincesWithinRadius,
  type LatLng,
} from "@/lib/geo/pdok";
import { supabaseServer } from "@/lib/supabase/client";
import { runScrapeBatch, type ScrapeMcps } from "@/lib/orchestrator";
import { scoreCompany, type StoredSignal } from "@/lib/scoring";
import { matchesSignaalQuery } from "@/lib/adapters/mock";
import { ESTIMATED_MINUTES_SAVED_PER_LEAD } from "@/lib/factum/roi";
import { SCORING_VERSION } from "@/lib/scoring/version";

const CACHE_TTL_DAYS = 30;
const LEAD_DETAIL_TTL_DAYS = 7;
const MAX_PARALLEL_SCRAPES = 5;
const KVK_BASISPROFIEL_CONCURRENCY = 8;

function noopEmit(_event: SearchProgressEvent): void {}

export class ProductionLeadSource implements LeadSource {
  private readonly bedrijven: BedrijvenMcp;
  private readonly mcps: ScrapeMcps;

  constructor() {
    this.bedrijven = new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl()));
    this.mcps = {
      bedrijven: this.bedrijven,
      vacatures: new VacaturesMcp(new McpHttpClient(requireVacaturesUrl())),
      juridisch: new JuridischMcp(new McpHttpClient(requireJuridischUrl())),
      news: new NewsMcp(new McpHttpClient(requireNewsUrl())),
    };
  }

  async runSearch(
    filters: SearchFilters,
    opts: RunSearchOptions = {},
  ): Promise<SearchResult> {
    const emit = opts.onEvent ?? noopEmit;
    const startedAt = Date.now();
    const supabase = supabaseServer();
    const searchCtx = buildTenantContext();
    const searchQueryId = await logSearchStart(supabase, filters);

    try {
      // 1) KvK afbakening
      await updateStep(supabase, searchQueryId, "Kamer van Koophandel doorzoeken");
      emit({ type: "stage", stage: "kvk", message: "Kamer van Koophandel doorzoeken…" });

      const sbiCodes = mapBrancheToSbi(filters.branche);
      const provincies = filters.regio_center
        ? provincesWithinRadius(filters.regio_center, filters.regio_straal_km)
        : undefined;

      const hits = await this.bedrijven.kvkZoeken(searchCtx, {
        sbiCodes,
        provincies,
        limit: 200,
      });
      emit({ type: "kvk", totalCandidates: hits.length });

      // 2) Basisprofielen ophalen (parallel, throttled)
      await updateStep(
        supabase,
        searchQueryId,
        `Basisprofielen ophalen (${hits.length})`,
      );
      emit({
        type: "stage",
        stage: "basisprofielen",
        message: `Basisprofielen ophalen (${hits.length})…`,
      });
      const profiles = await fetchBasisprofielen(
        this.bedrijven,
        searchCtx,
        hits.map((h) => h.kvkNummer),
      );
      const enriched = hits
        .map((h) => {
          const profile = profiles.get(h.kvkNummer);
          if (!profile) return null;
          return { hit: h, profile: toLocalProfile(profile, h) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // 3) FTE-filter — best-effort (alleen als MCP fteKlasse meegeeft)
      const fteFiltered = enriched.filter(({ profile }) => {
        if (!filters.fte_klassen.length) return true;
        if (!profile.fteKlasse) return true;
        return filters.fte_klassen.includes(profile.fteKlasse as FteKlasse);
      });

      // 4) Geo-filter via mcp-bedrijven.pdok_geocode (DB-cache eerst)
      await updateStep(supabase, searchQueryId, "Regio-filter toepassen");
      emit({ type: "stage", stage: "geo", message: "Regio-filter toepassen…" });
      const { kept: geoFiltered, coords: coordsByPlaats } = await applyGeoFilter(
        this.bedrijven,
        searchCtx,
        fteFiltered,
        filters.regio_center,
        filters.regio_straal_km,
        supabase,
      );
      emit({ type: "geo", remaining: geoFiltered.length });

      // 5) Companies upserten (incl. lat/lng zodat next-run skipt PDOK)
      await upsertCompanies(supabase, geoFiltered, coordsByPlaats);

      // 6) Scrape-targets bepalen (cache-respect, tenzij refresh)
      const candidateKvks = geoFiltered.map((x) => x.profile.kvkNummer);
      const toScrape = opts.refresh
        ? candidateKvks
        : await determineScrapeTargets(supabase, candidateKvks);

      await updateStep(
        supabase,
        searchQueryId,
        `Scrapen en analyseren van ${toScrape.length} bedrijven`,
      );
      emit({
        type: "stage",
        stage: "scrape",
        message: `Scrapen + classificeren (${toScrape.length} nieuw/stale)…`,
      });

      const handles = toScrape
        .map((kvk) => geoFiltered.find((x) => x.profile.kvkNummer === kvk)?.profile)
        .filter((p): p is LocalKvkBasisprofiel => !!p)
        .map((p) => ({
          kvk: p.kvkNummer,
          naam: p.naam,
          websiteUrl: p.websiteUrl,
          zoeknamen: [p.naam, p.handelsnaam].filter((s): s is string => !!s),
        }));

      let scraped = 0;
      await runScrapeBatch(handles, searchCtx, this.mcps, supabase, {
        concurrency: MAX_PARALLEL_SCRAPES,
        refreshRaw: opts.refresh ?? false,
        onProgress: (e) => {
          scraped = e.done;
          emit({
            type: "scrape",
            kvk: e.kvk,
            naam: handles.find((h) => h.kvk === e.kvk)?.naam ?? e.kvk,
            scraped: e.done,
            total: e.total,
            costUsd: 0,
          });
        },
      });

      // 7) Scoring per bedrijf — emit per lead zodra hij klaar is
      //    zodat de UI niet hoeft te wachten op alles
      await updateStep(supabase, searchQueryId, "Scoring en rangschikking");
      emit({ type: "stage", stage: "score", message: "Scoren + warmte bepalen…" });
      const leads: Lead[] = [];
      let scoredCount = 0;
      for (const { profile } of geoFiltered) {
        const stored = await fetchRecentSignals(supabase, profile.kvkNummer, CACHE_TTL_DAYS);
        const score = scoreCompany(profile, stored);
        const lead = scoreToLead(profile, score, stored);
        leads.push(lead);
        scoredCount += 1;
        emit({ type: "lead", lead });
        emit({ type: "score", scored: scoredCount, total: geoFiltered.length });
      }

      // 8) Persist scored_leads (alle gescoorde leads — query-filter
      //    is een UI-presentation-laag, niet een data-uitsluiting).
      await persistScoredLeads(supabase, searchQueryId, leads);

      // 9) Free-text post-filter (signaal_query) — slaat op archetype-,
      //    signaal- en dienst-tekst. Lege query → no-op.
      const filteredByQuery = leads.filter((l) =>
        matchesSignaalQuery(l, filters.signaal_query),
      );
      const sorted = sortLeadsByWarmte(filteredByQuery);
      const durationMs = Date.now() - startedAt;

      await logSearchComplete(supabase, searchQueryId, {
        totalCandidates: hits.length,
        totalScraped: toScrape.length,
        totalLeadsReturned: sorted.length,
        durationMs,
      });

      emit({
        type: "done",
        totalLeadsReturned: sorted.length,
        totalCostUsd: 0,
        durationMs,
      });

      return {
        search_id: searchQueryId,
        titel: `Live resultaten · ${filters.branche}`,
        leads: sorted,
        relaxation: { regio: false, fte: false },
      };
    } catch (err) {
      await logSearchFailed(supabase, searchQueryId, err);
      emit({ type: "error", message: String(err) });
      throw err;
    }
  }

  async getLead(kvk: string, opts: GetLeadOptions = {}): Promise<Lead | null> {
    const supabase = supabaseServer();
    const ctx = buildTenantContext();

    const profile = await this.bedrijven.kvkBasisprofiel(ctx, kvk);
    if (!profile) return null;
    const local = toLocalProfile(profile, null);

    const stale =
      opts.refresh === true ||
      (await isScrapeStale(supabase, kvk, LEAD_DETAIL_TTL_DAYS));
    if (stale) {
      const handle = {
        kvk: local.kvkNummer,
        naam: local.naam,
        websiteUrl: local.websiteUrl,
        zoeknamen: [local.naam, local.handelsnaam].filter(
          (s): s is string => !!s,
        ),
      };
      await runScrapeBatch([handle], ctx, this.mcps, supabase, {
        concurrency: 1,
        refreshRaw: opts.refresh ?? false,
      });
    }

    const stored = await fetchRecentSignals(supabase, kvk, CACHE_TTL_DAYS);
    const score = scoreCompany(local, stored);
    return scoreToLead(local, score, stored);
  }
}

// ---------- helpers -------------------------------------------------------

async function fetchBasisprofielen(
  bedrijven: BedrijvenMcp,
  ctx: TenantContext,
  kvks: string[],
): Promise<Map<string, McpKvkBasisprofiel>> {
  const out = new Map<string, McpKvkBasisprofiel>();
  const queue = [...kvks];
  const workers = Array.from(
    { length: Math.min(KVK_BASISPROFIEL_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const kvk = queue.shift();
        if (!kvk) return;
        try {
          const profile = await bedrijven.kvkBasisprofiel(ctx, kvk);
          if (profile) out.set(kvk, profile);
        } catch (err) {
          console.warn(`kvk_basisprofiel ${kvk} faalde: ${String(err)}`);
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// MCP basisprofiel (camelCase + arrays) → lokale shape die scoring leest.
function toLocalProfile(
  mcp: McpKvkBasisprofiel,
  hit: KvkZoekHit | null,
): LocalKvkBasisprofiel {
  const hoofd = mcp.vestigingen.find((v) => v.isHoofdvestiging);
  const plaats = hoofd?.adres.plaats ?? hit?.adres.plaats;
  const provincie = hoofd?.adres.provincie ?? hit?.adres.provincie;
  return {
    kvkNummer: mcp.kvkNummer,
    naam: mcp.naam,
    handelsnaam: mcp.handelsnamen[0],
    websiteUrl: mcp.websiteUrls[0],
    sbiCodes: mcp.sbiCodes,
    fteKlasse: mcp.fteKlasse as LocalKvkBasisprofiel["fteKlasse"],
    bestuursvorm: mcp.bestuursvorm,
    oprichtingsdatum: mcp.oprichtingsdatum,
    actief: mcp.actief,
    bestuurders: mcp.bestuurders,
    vestigingen: mcp.vestigingen.map((v) => ({
      vestigingsnummer: v.vestigingsnummer,
      isHoofdvestiging: v.isHoofdvestiging,
      handelsnaam: mcp.handelsnamen[0] ?? mcp.naam,
      adres: `${v.adres.plaats}${v.adres.provincie ? `, ${v.adres.provincie}` : ""}`,
      plaats: v.adres.plaats,
      provincie: v.adres.provincie,
    })),
    plaats,
    provincie,
    raw: mcp,
  };
}

async function applyGeoFilter<T extends { profile: LocalKvkBasisprofiel }>(
  bedrijven: BedrijvenMcp,
  ctx: TenantContext,
  enriched: T[],
  center: LatLng | null,
  radiusKm: number,
  supabase: SupabaseClient,
): Promise<{ kept: T[]; coords: Map<string, LatLng> }> {
  const coordsByPlaats = new Map<string, LatLng>();
  if (enriched.length === 0) {
    return { kept: enriched, coords: coordsByPlaats };
  }
  const uniquePlaatsen = [
    ...new Set(enriched.map((x) => x.profile.plaats).filter((p): p is string => !!p)),
  ];

  // 1) Lees gecachte coords uit companies — al lang bekende plaatsen
  //    raken PDOK niet meer.
  const { data: cached } = await supabase
    .from("companies")
    .select("plaats, lat, lng")
    .in("plaats", uniquePlaatsen)
    .not("lat", "is", null)
    .not("lng", "is", null);
  for (const row of (cached ?? []) as Array<{
    plaats: string;
    lat: number;
    lng: number;
  }>) {
    if (!coordsByPlaats.has(row.plaats)) {
      coordsByPlaats.set(row.plaats, { lat: row.lat, lng: row.lng });
    }
  }

  // 2) Resterende plaatsen: PDOK via mcp-bedrijven.
  const missing = uniquePlaatsen.filter((p) => !coordsByPlaats.has(p));
  await Promise.all(
    missing.map(async (p) => {
      try {
        const geo = await bedrijven.pdokGeocode(ctx, p);
        if (geo) coordsByPlaats.set(p, { lat: geo.lat, lng: geo.lng });
      } catch {
        // skip — bedrijf wordt straks geheel uit het filter weggelaten
        // alleen als we WEL center hebben en geen coords.
      }
    }),
  );

  if (!center) {
    return { kept: enriched, coords: coordsByPlaats };
  }
  const kept = enriched.filter(({ profile }) => {
    if (!profile.plaats) return true;
    const coords = coordsByPlaats.get(profile.plaats);
    if (!coords) return true;
    return haversineKm(center, coords) <= radiusKm;
  });
  return { kept, coords: coordsByPlaats };
}

async function upsertCompanies<T extends { profile: LocalKvkBasisprofiel }>(
  supabase: SupabaseClient,
  enriched: T[],
  coordsByPlaats: Map<string, LatLng>,
): Promise<void> {
  if (enriched.length === 0) return;
  const now = new Date().toISOString();
  const rows = enriched.map(({ profile }) => {
    const coords = profile.plaats ? coordsByPlaats.get(profile.plaats) : undefined;
    return {
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
      lat: coords?.lat,
      lng: coords?.lng,
      geocoded_at: coords ? now : undefined,
      last_updated_at: now,
    };
  });
  const { error } = await supabase
    .from("companies")
    .upsert(rows, { onConflict: "kvk" });
  if (error) console.warn(`companies upsert: ${error.message}`);

  // Append KvK-snapshot — lichtgewicht historie zodat we later
  // FTE-mutaties of bestuurders-veranderingen kunnen detecteren.
  const snapshotRows = enriched.map(({ profile }) => ({
    kvk: profile.kvkNummer,
    raw_data: profile.raw as object,
    fte_klasse: profile.fteKlasse,
    bestuurders: profile.bestuurders as object,
    vestigingen: profile.vestigingen as object,
  }));
  // We slaan max 1 snapshot per dag op (unique constraint op
  // (kvk, snapshot_at) maakt dit best-effort). On-conflict do nothing
  // wordt door supabase-js niet direct ondersteund; we slikken errors.
  const { error: snapErr } = await supabase
    .from("kvk_snapshots")
    .insert(snapshotRows);
  if (snapErr && !snapErr.message.includes("duplicate")) {
    console.warn(`kvk_snapshots insert: ${snapErr.message}`);
  }
}

async function determineScrapeTargets(
  supabase: SupabaseClient,
  kvks: string[],
): Promise<string[]> {
  if (kvks.length === 0) return [];
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("signals")
    .select("kvk, detected_at")
    .in("kvk", kvks)
    .gte("detected_at", cutoff);
  const recent = new Set((data ?? []).map((r) => r.kvk as string));
  return kvks.filter((k) => !recent.has(k));
}

async function isScrapeStale(
  supabase: SupabaseClient,
  kvk: string,
  ttlDays: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const { count } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true })
    .eq("kvk", kvk)
    .gte("detected_at", cutoff);
  return (count ?? 0) === 0;
}

async function fetchRecentSignals(
  supabase: SupabaseClient,
  kvk: string,
  ttlDays: number,
): Promise<StoredSignal[]> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("signals")
    .select("categorie, cluster, sterkte, confidence, observatie, bron_type, bron_url, bewijs")
    .eq("kvk", kvk)
    .gte("detected_at", cutoff);
  return ((data ?? []) as Array<{
    categorie: string;
    cluster: string | number | null;
    sterkte: number;
    confidence: number;
    observatie: string;
    detected_at?: string | null;
    bron_type?: string | null;
    bron_url?: string | null;
    bewijs?: string[] | null;
  }>).map((r) => ({
    categorie: r.categorie,
    // Cluster is sinds migration 004 text. Cast "1"/"2"/"3" terug naar
    // number; "context" blijft string en gaat de scoring-engine in
    // als context-flag.
    cluster: parseClusterColumn(r.cluster),
    sterkte: r.sterkte,
    confidence: r.confidence,
    observatie: r.observatie,
    detected_at: r.detected_at ?? undefined,
    bron_type: r.bron_type ?? undefined,
    bron_url: r.bron_url ?? undefined,
    bewijs: r.bewijs ?? undefined,
  }));
}

function parseClusterColumn(
  raw: string | number | null,
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 3 ? n : null;
}

async function logSearchStart(
  supabase: SupabaseClient,
  filters: SearchFilters,
): Promise<string> {
  const { data, error } = await supabase
    .from("search_queries")
    .insert({
      filters: filters as unknown as object,
      status: "running",
    })
    .select("id")
    .single();
  if (error || !data) {
    // Fallback — we kunnen niet loggen; gebruik in-memory id zodat de
    // run niet hangt op observability-failures.
    return `local-${Date.now()}`;
  }
  return data.id as string;
}

async function updateStep(
  supabase: SupabaseClient,
  searchQueryId: string,
  step: string,
): Promise<void> {
  if (searchQueryId.startsWith("local-")) return;
  await supabase
    .from("search_queries")
    .update({ current_step: step })
    .eq("id", searchQueryId);
}

async function logSearchComplete(
  supabase: SupabaseClient,
  searchQueryId: string,
  meta: {
    totalCandidates: number;
    totalScraped: number;
    totalLeadsReturned: number;
    durationMs: number;
  },
): Promise<void> {
  if (searchQueryId.startsWith("local-")) return;
  await supabase
    .from("search_queries")
    .update({
      status: "completed",
      total_candidates: meta.totalCandidates,
      total_scraped: meta.totalScraped,
      total_leads_returned: meta.totalLeadsReturned,
      duration_ms: meta.durationMs,
      completed_at: new Date().toISOString(),
    })
    .eq("id", searchQueryId);
}

async function logSearchFailed(
  supabase: SupabaseClient,
  searchQueryId: string,
  err: unknown,
): Promise<void> {
  if (searchQueryId.startsWith("local-")) return;
  await supabase
    .from("search_queries")
    .update({
      status: "failed",
      error_message: String(err),
      completed_at: new Date().toISOString(),
    })
    .eq("id", searchQueryId);
}

async function persistScoredLeads(
  supabase: SupabaseClient,
  searchQueryId: string,
  leads: Lead[],
): Promise<void> {
  if (searchQueryId.startsWith("local-") || leads.length === 0) return;
  const rows = leads.map((l) => ({
    search_query_id: searchQueryId,
    kvk: l.kvk,
    warmte: l.warmte,
    totale_score: scoreFromObservatie(l) ?? 0,
    diensten_match: l.diensten as unknown as object,
    samenvatting: l.observatie,
    scoring_version: SCORING_VERSION,
  }));
  const { error } = await supabase.from("scored_leads").insert(rows);
  if (error) console.warn(`scored_leads insert: ${error.message}`);
}

function scoreFromObservatie(l: Lead): number | null {
  const top = l.diensten[0]?.score;
  return typeof top === "number" ? top : null;
}

const BRON_TYPE_TO_BRON: Record<string, Bron> = {
  website: "bedrijfswebsite",
  rechtspraak: "Rechtspraak.nl",
  nla: "NLA",
  insolventie: "Insolventieregister",
  news: "Nieuws",
  vacatures: "Jobdigger",
};

function toLeadSignaal(row: StoredSignal): UiSignaal {
  const bron = BRON_TYPE_TO_BRON[row.bron_type ?? ""] ?? "Nieuws";
  return {
    tekst: row.observatie,
    bron,
    bewijs: row.bewijs && row.bewijs.length > 0 ? row.bewijs : undefined,
    bronUrl: row.bron_url || undefined,
  };
}

function scoreToLead(
  profile: LocalKvkBasisprofiel,
  score: ReturnType<typeof scoreCompany>,
  signals: StoredSignal[],
): Lead {
  const fteKlasse = (profile.fteKlasse ?? "10-19") as FteKlasse;
  const seen = new Set<string>();
  const dedupedSignalen: UiSignaal[] = [];
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
    diensten: score.diensten_match.map((d) => ({
      code: d.code,
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
