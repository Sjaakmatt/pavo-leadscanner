// Per bedrijf: domein-MCP-tools parallel → classificatie per bron →
// persist naar Supabase signals-tabel.
//
// Sinds de mcp-webscraper-split (apr 2026) draaien de scrapers verspreid
// over vier domein-MCPs:
//   - mcp-bedrijven  → get_company_website_content
//   - mcp-vacatures  → extract_vacancies_from_company_site
//   - mcp-juridisch  → search_court_cases | search_labor_inspections | search_insolvencies
//   - mcp-news       → search_company_news
//
// Iedere scrape krijgt zijn eigen toolCallId; parentCallId blijft
// constant binnen één searchQueryId zodat het FactumAI-dashboard de
// hele zoekopdracht als één trace toont.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/mcp/client";
import { BedrijvenMcp } from "@/lib/mcp/bedrijven";
import { VacaturesMcp } from "@/lib/mcp/vacatures";
import { JuridischMcp } from "@/lib/mcp/juridisch";
import { NewsMcp } from "@/lib/mcp/news";
import {
  classifyWebsiteFull,
  classifyRechtspraak,
  classifyNla,
  classifyInsolventie,
  classifyVacatures,
  classifyNews,
} from "@/lib/classification";
import type { Signaal } from "@/lib/scoring/types";
import { persistRaw, readRaw, type CachedToolName } from "./raw-cache";
import { upsertWebsiteContacts } from "@/lib/lead-source/contacts";
import { inferWebsiteUrl } from "./website-inference";
import type {
  WebsiteScrapeResult,
  VacatureRawResult,
  RechtspraakRawResult,
  NlaRawResult,
  InsolventieRawResult,
  NewsRawResult,
} from "@/lib/mcp/schemas";

export type ScrapeMcps = {
  bedrijven: BedrijvenMcp;
  vacatures: VacaturesMcp;
  juridisch: JuridischMcp;
  news: NewsMcp;
};

export type CompanyHandle = {
  kvk: string;
  naam: string;
  websiteUrl?: string;
  zoeknamen: string[];
};

export type OrchestrationResult = {
  kvk: string;
  signalen: Signaal[];
  durationMs: number;
  failures: string[]; // tool-namen die faalden, voor logging
  // Geinferreerde website-URL als KvK 'm niet leverde — caller kan deze
  // optioneel terug-persisten naar companies-tabel.
  inferredWebsiteUrl?: string;
};

const TOOL_TIMEOUT_MS = 60_000;
// Cache-TTL voor ruwe MCP-payloads. Korter dan signals-TTL (30d) zodat
// een refresh sneller terug-naar-MCP gaat als het aanvoelt als stale.
const RAW_CACHE_TTL_DAYS = 14;

export type ScrapeOptions = {
  // Negeer de raw-cache en doe sowieso een nieuwe MCP-call. Default false:
  // we gebruiken eerst de cache als die bestaat én jonger is dan TTL.
  refreshRaw?: boolean;
};

export async function scrapeAndClassifyCompany(
  company: CompanyHandle,
  parentCtx: TenantContext,
  mcps: ScrapeMcps,
  supabase: SupabaseClient,
  opts: ScrapeOptions = {},
): Promise<OrchestrationResult> {
  const start = Date.now();
  const failures: string[] = [];

  // Per call een eigen toolCallId; parentCallId is de search-run.
  const ctxFor = (_toolName: string): TenantContext => ({
    organizationId: parentCtx.organizationId,
    agentId: parentCtx.agentId,
    toolCallId: randomId(),
    parentCallId: parentCtx.toolCallId,
  });

  // Website-inference: als KvK-basisprofiel geen websiteUrl had, probeer
  // 'm af te leiden uit de bedrijfsnaam ("Joz B.V." → joz.nl). Best-effort
  // — geen match → website + vacatures tasks worden geskipt zoals voorheen.
  // Persist terug naar companies-tabel zodat volgende search dit niet
  // opnieuw hoeft te doen.
  let resolvedWebsiteUrl = company.websiteUrl;
  let inferredWebsiteUrl: string | undefined;
  if (!resolvedWebsiteUrl) {
    try {
      const inferred = await inferWebsiteUrl(company.naam);
      if (inferred) {
        resolvedWebsiteUrl = inferred;
        inferredWebsiteUrl = inferred;
        console.log(
          `[orchestrator] inferred website for ${company.kvk} "${company.naam}": ${inferred}`,
        );
        // Best-effort persist; faalt deze update dan loopt de pipeline
        // gewoon door — next-run probeert opnieuw.
        void supabase
          .from("companies")
          .update({
            website_url: inferred,
            last_updated_at: new Date().toISOString(),
          })
          .eq("kvk", company.kvk);
      }
    } catch (err) {
      console.warn(
        `[orchestrator] inferWebsiteUrl faalde voor ${company.kvk}: ${String(err)}`,
      );
    }
  }

  // Fase 1: alle scrapers parallel — elk faalt onafhankelijk.
  // Iedere fetch loopt via fetchWithCache() die de raw-cache leest/schrijft.
  const tasks: Array<Promise<{ tool: string; signals: Signaal[] }>> = [];

  if (resolvedWebsiteUrl) {
    tasks.push(
      fetchWithCache<WebsiteScrapeResult>(
        supabase,
        company.kvk,
        "get_company_website_content",
        opts.refreshRaw ?? false,
        () =>
          mcps.bedrijven.getCompanyWebsiteContent(
            ctxFor("get_company_website_content"),
            { url: resolvedWebsiteUrl!, maxPages: 5 },
          ),
      ).then(async (r) => {
        if (!r) return mark("get_company_website_content");
        const full = await classifyWebsiteFull(company, r);
        // Best-effort: contacten persisten in een fire-and-forget zodat
        // signaal-flow niet wacht op de contacts-upsert.
        if (full.contacten.length > 0) {
          void upsertWebsiteContacts(supabase, company.kvk, full.contacten);
        }
        return { tool: "website", signals: full.signalen };
      }),
    );
    tasks.push(
      fetchWithCache<VacatureRawResult>(
        supabase,
        company.kvk,
        "extract_vacancies_from_company_site",
        opts.refreshRaw ?? false,
        () =>
          mcps.vacatures.extractVacanciesFromCompanySite(
            ctxFor("extract_vacancies_from_company_site"),
            { url: resolvedWebsiteUrl! },
          ),
      ).then((r) =>
        r
          ? { tool: "vacatures", signals: classifyVacatures(company, r) }
          : mark("extract_vacancies_from_company_site"),
      ),
    );
  }

  tasks.push(
    fetchWithCache<RechtspraakRawResult>(
      supabase,
      company.kvk,
      "search_court_cases",
      opts.refreshRaw ?? false,
      () =>
        mcps.juridisch.searchCourtCases(ctxFor("search_court_cases"), {
          company_names: company.zoeknamen,
        }),
    ).then(async (r) =>
      r
        ? { tool: "rechtspraak", signals: await classifyRechtspraak(company, r) }
        : mark("search_court_cases"),
    ),
  );

  tasks.push(
    fetchWithCache<NlaRawResult>(
      supabase,
      company.kvk,
      "search_labor_inspections",
      opts.refreshRaw ?? false,
      () =>
        mcps.juridisch.searchLaborInspections(
          ctxFor("search_labor_inspections"),
          { search_term: company.naam },
        ),
    ).then(async (r) =>
      r
        ? { tool: "nla", signals: await classifyNla(company, r) }
        : mark("search_labor_inspections"),
    ),
  );

  tasks.push(
    fetchWithCache<InsolventieRawResult>(
      supabase,
      company.kvk,
      "search_insolvencies",
      opts.refreshRaw ?? false,
      () =>
        mcps.juridisch.searchInsolvencies(ctxFor("search_insolvencies"), {
          company_names: company.zoeknamen,
        }),
    ).then((r) =>
      r
        ? { tool: "insolventie", signals: classifyInsolventie(company, r) }
        : mark("search_insolvencies"),
    ),
  );

  tasks.push(
    fetchWithCache<NewsRawResult>(
      supabase,
      company.kvk,
      "search_company_news",
      opts.refreshRaw ?? false,
      () =>
        mcps.news.searchCompanyNews(ctxFor("search_company_news"), {
          company_name: company.naam,
          max_results: 20,
        }),
    ).then(async (r) =>
      r
        ? { tool: "news", signals: await classifyNews(company, r) }
        : mark("search_company_news"),
    ),
  );

  const settled = await Promise.allSettled(tasks);
  const allSignals: Signaal[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value && s.value.signals) {
      allSignals.push(...s.value.signals);
    } else if (s.status === "rejected") {
      failures.push(String(s.reason));
    }
  }

  // Fase 3: persist naar Supabase. Één insert per signaal; we koppelen
  // ze aan de search-run via parentCallId (mcp_tool_call_id).
  await persistSignals(supabase, company.kvk, allSignals, parentCtx.toolCallId);

  return {
    kvk: company.kvk,
    signalen: allSignals,
    durationMs: Date.now() - start,
    failures,
    inferredWebsiteUrl,
  };

  function mark(tool: string): { tool: string; signals: Signaal[] } {
    failures.push(tool);
    return { tool, signals: [] };
  }

  async function fetchWithCache<T>(
    db: SupabaseClient,
    kvk: string,
    tool: CachedToolName,
    refresh: boolean,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (!refresh) {
      const cached = await readRaw<T>(db, kvk, tool, RAW_CACHE_TTL_DAYS);
      if (cached) return cached;
    }
    try {
      const result = await withTimeout(fn(), TOOL_TIMEOUT_MS, tool);
      // Best-effort persist — pipeline niet ophouden als cache faalt.
      void persistRaw(db, kvk, tool, result as unknown);
      return result;
    } catch (err) {
      console.warn(`[orchestrator] ${tool} faalde voor ${kvk}:`, err);
      return null;
    }
  }
}

async function persistSignals(
  supabase: SupabaseClient,
  kvk: string,
  signalen: Signaal[],
  mcpToolCallId: string,
): Promise<void> {
  if (signalen.length === 0) return;
  const rows = signalen.map((s) => ({
    kvk,
    categorie: s.categorie,
    // Cluster wordt als text opgeslagen (zie migration 004) zodat
    // "context" niet in NULL valt.
    cluster: typeof s.cluster === "number" ? String(s.cluster) : s.cluster,
    sterkte: s.sterkte,
    confidence: s.confidence,
    observatie: s.observatie,
    bewijs: s.bewijs ?? null,
    bron_url: s.bronUrl ?? null,
    bron_type: s.bronType,
    mcp_tool_call_id: mcpToolCallId,
  }));
  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    console.warn(`[orchestrator] signals insert faalde voor ${kvk}: ${error.message}`);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout na ${ms}ms`)), ms),
    ),
  ]);
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
