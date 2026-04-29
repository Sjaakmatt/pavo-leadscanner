// MCP-based ProductionLeadSource. Praat uitsluitend met de vier externe
// FactumAI domein-MCPs — geen in-process scrapers, geen directe KvK-client.
//
// KvK Zoeken-API v2 ondersteunt geen SBI- of provincie-filter (sinds april
// 2026). De pijplijn werkt daarom plaats-georiënteerd:
//
//   1. plaatsenWithinRadius(center, radius) → lijst NL-plaatsen in target-area
//   2. Supabase companies-cache → bestaande SBI+FTE-matches in target-plaatsen
//   3. mcp-bedrijven.kvk_zoeken per plaats (gratis) → onbekende kvk-nummers
//   4. mcp-bedrijven.kvk_basisprofiel (€0.02 per call, hard cap via
//      MAX_BASISPROFIELEN_PER_SEARCH) → SBI + FTE per kandidaat;
//      filter daarop
//   5. mcp-bedrijven.pdok_geocode               (per onbekende plaats voor fijn-haversine)
//   6. Upsert companies-row + bestuurders + kvk_snapshots
//   7. Per match parallel via orchestrator:
//        mcp-bedrijven.get_company_website_content
//        mcp-vacatures.extract_vacancies_from_company_site
//        mcp-juridisch.search_court_cases / search_labor_inspections / search_insolvencies
//        mcp-news.search_company_news
//      → classificatie naar PAVO-Signaal[]
//   8. scoring engine → LeadScore
//   9. scored_leads + search_queries afronden
//
// Budget-guard:
//  - MAX_BASISPROFIELEN_PER_SEARCH (default 200) → ~€4 absolute cap
//  - MAX_COST_PER_SEARCH_USD voor scrape-/classify-stap (LLM-tokens via CostTracker)
// Bij eerste zoekopdracht in een nieuwe regio is dit de duurste run; alle
// volgende runs hitten de Supabase-cache → praktisch gratis.

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
import { haversineKm, type LatLng } from "@/lib/geo/pdok";
import { plaatsenWithinRadius } from "@/lib/geo/plaatsen";
import { supabaseServer } from "@/lib/supabase/client";
import { runScrapeBatch, type ScrapeMcps } from "@/lib/orchestrator";
import { scoreCompany, type StoredSignal } from "@/lib/scoring";
import { matchesSignaalQuery } from "@/lib/adapters/mock";
import { ESTIMATED_MINUTES_SAVED_PER_LEAD } from "@/lib/factum/roi";
import { SCORING_VERSION } from "@/lib/scoring/version";
import { CostTracker, withSearchScope } from "@/lib/classification/cost";
import { upsertKvkBestuurders } from "@/lib/lead-source/contacts";
import { getCurrentUser, authConfigured } from "@/lib/auth/server";

const CACHE_TTL_DAYS = 30;
const LEAD_DETAIL_TTL_DAYS = 7;
const MAX_PARALLEL_SCRAPES = 5;
const KVK_BASISPROFIEL_CONCURRENCY = 8;

// Hard cap op het aantal betaalde basisprofiel-calls per zoekopdracht.
// Met €0.02/call → 200 calls = €4 absolute ceiling. Override via
// `MAX_BASISPROFIELEN_PER_SEARCH` env-var voor power-users.
const MAX_BASISPROFIELEN_PER_SEARCH = (() => {
  const raw = Number(process.env.MAX_BASISPROFIELEN_PER_SEARCH ?? 200);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
})();

const DEFAULT_RADIUS_KM = 25;
// Cap op aantal plaatsen die we per search aflopen — grote radii leveren
// anders te veel plaatsen op die elk weer hun eigen Zoeken-call doen.
const MAX_PLAATSEN_PER_SEARCH = 8;
// Maximum hits die we uit één Zoeken-call accepteren. KvK v2 max = 100.
const ZOEKEN_PAGE_SIZE = 100;
const LIMIT_PER_SEARCH = 50;

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

    // Resolve org-scope: bij prod-mode trekken we 'm uit de session;
    // bij cron/jobs zonder request-context kunnen opts.orgId / opts.ownerId
    // overrules. Demo zonder auth → null (geen scoping).
    const orgId = opts.orgId ?? (await tryGetOrgId());
    const ownerId = opts.ownerId ?? null;

    const searchQueryId = await logSearchStart(supabase, filters, {
      orgId,
      ownerId,
    });

    const tracker = new CostTracker();
    return withSearchScope(
      { tracker, supabase, searchQueryId },
      () => this.runSearchInScope(
        filters,
        opts,
        emit,
        startedAt,
        supabase,
        searchCtx,
        searchQueryId,
        tracker,
        orgId,
      ),
    );
  }

  private async runSearchInScope(
    filters: SearchFilters,
    opts: RunSearchOptions,
    emit: NonNullable<RunSearchOptions["onEvent"]>,
    startedAt: number,
    supabase: SupabaseClient,
    searchCtx: TenantContext,
    searchQueryId: string,
    tracker: CostTracker,
    orgId: string | null,
  ): Promise<SearchResult> {
    // Per-stage timings — geschreven naar search_queries aan het eind.
    const timing = {
      kvk_ms: 0,
      basisprofiel_ms: 0,
      geo_ms: 0,
      scrape_ms: 0,
      score_ms: 0,
    };

    try {
      // 1) KvK afbakening: bepaal target-plaatsen uit center + radius.
      await updateStep(supabase, searchQueryId, "Plaatsen bepalen voor zoekgebied");
      emit({ type: "stage", stage: "kvk", message: "Zoekgebied opdelen in plaatsen…" });

      const kvkStart = Date.now();
      const sbiCodes = mapBrancheToSbi(filters.branche);
      const targetPlaatsen = filters.regio_center
        ? plaatsenWithinRadius(
            filters.regio_center,
            filters.regio_straal_km ?? DEFAULT_RADIUS_KM,
            { maxPlaatsen: MAX_PLAATSEN_PER_SEARCH },
          )
        : [];

      if (targetPlaatsen.length === 0 && filters.regio_center) {
        timing.kvk_ms = Date.now() - kvkStart;
        emit({ type: "kvk", totalCandidates: 0 });
        emit({
          type: "stage",
          stage: "score",
          message: "Geen plaatsen in straal — vergroot de radius en probeer opnieuw.",
        });
        const cost = tracker.snapshot();
        await logSearchComplete(supabase, searchQueryId, {
          totalCandidates: 0,
          totalScraped: 0,
          totalLeadsReturned: 0,
          durationMs: Date.now() - startedAt,
          timing,
          cost,
        });
        emit({
          type: "done",
          totalLeadsReturned: 0,
          totalCostUsd: cost.totalUsd,
          durationMs: Date.now() - startedAt,
        });
        return {
          search_id: searchQueryId,
          titel: `Geen plaatsen in straal · ${filters.branche}`,
          leads: [],
          relaxation: { regio: false, fte: false },
        };
      }

      // 2) Cache-first: companies-tabel bevat al SBI + FTE per kvk uit
      // eerdere searches. Pak alle matches in target-plaatsen meteen.
      const cachedProfiles = await loadCachedProfiles(supabase, {
        plaatsen: targetPlaatsen,
        sbiCodes,
        fteKlassen: filters.fte_klassen,
      });
      emit({
        type: "stage",
        stage: "basisprofielen",
        message: `Cache: ${cachedProfiles.length} bekende matches; KvK doorzoeken voor nieuwe…`,
      });

      // 3) Zoeken-v2 per plaats (gratis) → onbekende kvk-nummers, dan
      //    basisprofiel per kandidaat (€0.02) met SBI+FTE-filter en
      //    early-stop zodra `LIMIT_PER_SEARCH` nieuwe matches gevonden.
      const remainingNeeded = Math.max(0, LIMIT_PER_SEARCH - cachedProfiles.length);

      const knownKvks = new Set(cachedProfiles.map((p) => p.kvkNummer));
      const newProfiles: LocalKvkBasisprofiel[] = [];
      let basisprofielenSpent = 0;
      let kvkHitsTotal = cachedProfiles.length;

      if (remainingNeeded > 0) {
        for (const plaats of targetPlaatsen) {
          if (newProfiles.length >= remainingNeeded) break;
          if (basisprofielenSpent >= MAX_BASISPROFIELEN_PER_SEARCH) break;

          const hits = await this.bedrijven.kvkZoeken(searchCtx, {
            plaatsen: [plaats],
            type: "hoofdvestiging",
            limit: ZOEKEN_PAGE_SIZE,
          });
          kvkHitsTotal += hits.length;
          emit({ type: "kvk", totalCandidates: kvkHitsTotal });

          const candidates = hits
            .map((h) => h.kvkNummer)
            .filter((kvk) => !knownKvks.has(kvk));
          for (const kvk of candidates) knownKvks.add(kvk);

          await fetchBasisprofielenWithFilter({
            bedrijven: this.bedrijven,
            ctx: searchCtx,
            kvks: candidates,
            sbiFilter: sbiCodes,
            fteFilter: filters.fte_klassen,
            spendBudget: () => MAX_BASISPROFIELEN_PER_SEARCH - basisprofielenSpent,
            matchesNeeded: () => remainingNeeded - newProfiles.length,
            onSpend: () => {
              basisprofielenSpent += 1;
            },
            onMatch: (profile) => {
              newProfiles.push(toLocalProfile(profile, null));
              emit({ type: "kvk", totalCandidates: kvkHitsTotal });
            },
            concurrency: KVK_BASISPROFIEL_CONCURRENCY,
          });
        }
      }

      timing.kvk_ms = Date.now() - kvkStart;
      timing.basisprofiel_ms = timing.kvk_ms;
      const enriched = [...cachedProfiles, ...newProfiles].map((profile) => ({
        hit: null as KvkZoekHit | null,
        profile,
      }));

      // 4) Geo-filter via PDOK + haversine — fine-tune binnen de plaats.
      await updateStep(supabase, searchQueryId, "Regio-filter toepassen");
      emit({ type: "stage", stage: "geo", message: "Regio-filter toepassen…" });
      const geoStart = Date.now();
      const { kept: geoFiltered, coords: coordsByPlaats } = await applyGeoFilter(
        this.bedrijven,
        searchCtx,
        enriched,
        filters.regio_center,
        filters.regio_straal_km ?? DEFAULT_RADIUS_KM,
        supabase,
      );
      timing.geo_ms = Date.now() - geoStart;
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

      const scrapeStart = Date.now();
      let scraped = 0;
      await runScrapeBatch(handles, searchCtx, this.mcps, supabase, {
        concurrency: MAX_PARALLEL_SCRAPES,
        refreshRaw: opts.refresh ?? false,
        // Stop met scrapen zodra de budget-guard slaat — kosten lopen
        // anders door op rechtspraak/news ondanks dat classifier al is
        // gestopt. We laten de batch wel afronden voor in-flight calls.
        shouldAbort: () => tracker.shouldHalt(),
        onProgress: (e) => {
          scraped = e.done;
          emit({
            type: "scrape",
            kvk: e.kvk,
            naam: handles.find((h) => h.kvk === e.kvk)?.naam ?? e.kvk,
            scraped: e.done,
            total: e.total,
            costUsd: tracker.snapshot().totalUsd,
          });
        },
      });
      timing.scrape_ms = Date.now() - scrapeStart;

      // 7) Scoring per bedrijf — emit per lead zodra hij klaar is
      //    zodat de UI niet hoeft te wachten op alles
      await updateStep(supabase, searchQueryId, "Scoring en rangschikking");
      emit({ type: "stage", stage: "score", message: "Scoren + warmte bepalen…" });
      const scoreStart = Date.now();
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
      timing.score_ms = Date.now() - scoreStart;

      // 8) Persist scored_leads (alle gescoorde leads — query-filter
      //    is een UI-presentation-laag, niet een data-uitsluiting).
      await persistScoredLeads(supabase, searchQueryId, leads, orgId);

      // 9) Free-text post-filter (signaal_query) — slaat op archetype-,
      //    signaal- en dienst-tekst. Lege query → no-op.
      const filteredByQuery = leads.filter((l) =>
        matchesSignaalQuery(l, filters.signaal_query),
      );
      const sorted = sortLeadsByWarmte(filteredByQuery);
      const durationMs = Date.now() - startedAt;
      const cost = tracker.snapshot();

      await logSearchComplete(supabase, searchQueryId, {
        totalCandidates: kvkHitsTotal,
        totalScraped: toScrape.length,
        totalLeadsReturned: sorted.length,
        durationMs,
        timing,
        cost,
      });

      emit({
        type: "done",
        totalLeadsReturned: sorted.length,
        totalCostUsd: cost.totalUsd,
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
      // Geen searchQueryId — solo refresh — maar wel een tracker
      // zodat het budget alsnog gehandhaafd wordt.
      const tracker = new CostTracker();
      await withSearchScope(
        { tracker, supabase, searchQueryId: null },
        () =>
          runScrapeBatch([handle], ctx, this.mcps, supabase, {
            concurrency: 1,
            refreshRaw: opts.refresh ?? false,
            shouldAbort: () => tracker.shouldHalt(),
          }),
      );
    }

    const stored = await fetchRecentSignals(supabase, kvk, CACHE_TTL_DAYS);
    const score = scoreCompany(local, stored);
    return scoreToLead(local, score, stored);
  }
}

// ---------- helpers -------------------------------------------------------

/**
 * Lees companies-cache: alle bekende kvk's in de target-plaatsen die
 * voldoen aan SBI- en FTE-filter. Cache-hit → €0 per kvk; we omzeilen
 * Zoeken én basisprofiel volledig voor bekende bedrijven.
 *
 * De companies-tabel wordt gevuld bij elke search die wél basisprofielen
 * fetcht; na een paar runs in een regio is dit zelfvoorzienend.
 */
async function loadCachedProfiles(
  supabase: SupabaseClient,
  args: {
    plaatsen: string[];
    sbiCodes: string[];
    fteKlassen: FteKlasse[];
  },
): Promise<LocalKvkBasisprofiel[]> {
  if (args.plaatsen.length === 0) return [];

  let query = supabase
    .from("companies")
    .select(
      "kvk, naam, handelsnaam, website_url, sbi_codes, fte_klasse, plaats, provincie, bestuursvorm, oprichtingsdatum, actief",
    )
    .in("plaats", args.plaatsen)
    .eq("actief", true);

  if (args.sbiCodes.length > 0) {
    query = query.overlaps("sbi_codes", args.sbiCodes);
  }
  if (args.fteKlassen.length > 0) {
    query = query.in("fte_klasse", args.fteKlassen);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(`loadCachedProfiles: ${error.message}`);
    return [];
  }

  return ((data ?? []) as Array<{
    kvk: string;
    naam: string;
    handelsnaam?: string | null;
    website_url?: string | null;
    sbi_codes: string[] | null;
    fte_klasse: string | null;
    plaats: string | null;
    provincie: string | null;
    bestuursvorm: string | null;
    oprichtingsdatum: string | null;
    actief: boolean;
  }>).map((row) => ({
    kvkNummer: row.kvk,
    naam: row.naam,
    handelsnaam: row.handelsnaam ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    sbiCodes: row.sbi_codes ?? [],
    fteKlasse: (row.fte_klasse ?? undefined) as LocalKvkBasisprofiel["fteKlasse"],
    bestuursvorm: row.bestuursvorm ?? undefined,
    oprichtingsdatum: row.oprichtingsdatum ?? undefined,
    actief: row.actief,
    bestuurders: [],
    vestigingen: row.plaats
      ? [
          {
            vestigingsnummer: "",
            isHoofdvestiging: true,
            handelsnaam: row.handelsnaam ?? row.naam,
            adres: `${row.plaats}${row.provincie ? `, ${row.provincie}` : ""}`,
            plaats: row.plaats,
            provincie: row.provincie ?? undefined,
          },
        ]
      : [],
    plaats: row.plaats ?? undefined,
    provincie: row.provincie ?? undefined,
    raw: null,
  }));
}

/**
 * Parallel basisprofiel-fetch met SBI+FTE-filter en budget-guard.
 * Stopt zodra `matchesNeeded()` 0 is of `spendBudget()` 0 is — early-stop
 * werkt zelfs als andere workers dat trigger raken.
 */
async function fetchBasisprofielenWithFilter(args: {
  bedrijven: BedrijvenMcp;
  ctx: TenantContext;
  kvks: string[];
  sbiFilter: string[];
  fteFilter: FteKlasse[];
  spendBudget: () => number;
  matchesNeeded: () => number;
  onSpend: () => void;
  onMatch: (profile: McpKvkBasisprofiel) => void;
  concurrency: number;
}): Promise<void> {
  const { bedrijven, ctx, kvks, sbiFilter, fteFilter } = args;
  if (kvks.length === 0) return;

  const queue = [...kvks];
  const workers = Array.from(
    { length: Math.min(args.concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        if (args.matchesNeeded() <= 0) return;
        if (args.spendBudget() <= 0) return;
        const kvk = queue.shift();
        if (!kvk) return;
        args.onSpend();
        try {
          const profile = await bedrijven.kvkBasisprofiel(ctx, kvk);
          if (!profile) continue;
          if (sbiFilter.length > 0 && !hasSbiOverlap(profile.sbiCodes, sbiFilter)) {
            continue;
          }
          if (fteFilter.length > 0 && !matchesFteKlasse(profile.fteKlasse, fteFilter)) {
            continue;
          }
          args.onMatch(profile);
        } catch (err) {
          console.warn(`kvk_basisprofiel ${kvk} faalde: ${String(err)}`);
        }
      }
    },
  );
  await Promise.all(workers);
}

function hasSbiOverlap(profileSbi: string[], filterSbi: string[]): boolean {
  if (filterSbi.length === 0) return true;
  const set = new Set(filterSbi);
  return profileSbi.some((c) => set.has(c));
}

/**
 * MCP retourneert FTE-buckets met andere bovenrand-grenzen ("100-249",
 * "250+") dan de UI-filter ("100-199"). Vertaal beide naar overlap.
 */
function matchesFteKlasse(
  mcpKlasse: string | undefined,
  filter: FteKlasse[],
): boolean {
  if (!mcpKlasse) return false;
  if (filter.includes(mcpKlasse as FteKlasse)) return true;
  if ((mcpKlasse === "100-249" || mcpKlasse === "250+") && filter.includes("100-199")) {
    return true;
  }
  return false;
}

// MCP basisprofiel (camelCase + arrays) → lokale shape die scoring leest.
function toLocalProfile(
  mcp: McpKvkBasisprofiel,
  hit: KvkZoekHit | null,
): LocalKvkBasisprofiel {
  const hoofd = mcp.vestigingen.find((v) => v.isHoofdvestiging);
  const plaats = hoofd?.adres.plaats ?? hit?.adres.plaats;
  // KvK Zoeken-v2 en Basisprofiel-v1 leveren geen provincie meer mee.
  // Provincie blijft undefined tot we 'm via postcode-prefix afleiden.
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
      adres: v.adres.plaats,
      plaats: v.adres.plaats,
    })),
    plaats,
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

  // KvK-bestuurders → lead_contacts. Deze data zit al in het basisprofiel,
  // we surface 'em zodat sales direct namen + functies ziet.
  await Promise.all(
    enriched.map(({ profile }) =>
      upsertKvkBestuurders(
        supabase,
        profile.kvkNummer,
        profile.bestuurders ?? [],
      ),
    ),
  );

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
  scope: { orgId: string | null; ownerId: string | null } = {
    orgId: null,
    ownerId: null,
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("search_queries")
    .insert({
      filters: filters as unknown as object,
      status: "running",
      org_id: scope.orgId,
      created_by: scope.ownerId,
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

async function tryGetOrgId(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const me = await getCurrentUser();
    return me?.orgId ?? null;
  } catch {
    return null;
  }
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
    timing: {
      kvk_ms: number;
      basisprofiel_ms: number;
      geo_ms: number;
      scrape_ms: number;
      score_ms: number;
    };
    cost: {
      totalUsd: number;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      budgetExceeded: boolean;
    };
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
      kvk_ms: meta.timing.kvk_ms,
      basisprofiel_ms: meta.timing.basisprofiel_ms,
      geo_ms: meta.timing.geo_ms,
      scrape_ms: meta.timing.scrape_ms,
      score_ms: meta.timing.score_ms,
      total_cost_usd: meta.cost.totalUsd,
      classification_calls: meta.cost.calls,
      classification_input_tokens: meta.cost.inputTokens,
      classification_output_tokens: meta.cost.outputTokens,
      budget_exceeded: meta.cost.budgetExceeded,
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
  orgId: string | null,
): Promise<void> {
  if (searchQueryId.startsWith("local-") || leads.length === 0) return;
  const rows = leads.map((l) => ({
    search_query_id: searchQueryId,
    org_id: orgId,
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
    cold_redenen:
      score.cold_redenen.length > 0 ? score.cold_redenen : undefined,
  };
}

function sortLeadsByWarmte(leads: Lead[]): Lead[] {
  const rank = { HOT: 0, WARM: 1, COLD: 2 } as const;
  return [...leads].sort((a, b) => rank[a.warmte] - rank[b.warmte]);
}
