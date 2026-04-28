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
  classifyWebsite,
  classifyRechtspraak,
  classifyNla,
  classifyInsolventie,
  classifyVacatures,
  classifyNews,
} from "@/lib/classification";
import type { Signaal } from "@/lib/scoring/types";

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
};

const TOOL_TIMEOUT_MS = 60_000;

export async function scrapeAndClassifyCompany(
  company: CompanyHandle,
  parentCtx: TenantContext,
  mcps: ScrapeMcps,
  supabase: SupabaseClient,
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

  // Fase 1: alle scrapers parallel — elk faalt onafhankelijk.
  const tasks: Array<Promise<{ tool: string; signals: Signaal[] }>> = [];

  if (company.websiteUrl) {
    tasks.push(
      run("get_company_website_content", () =>
        mcps.bedrijven.getCompanyWebsiteContent(
          ctxFor("get_company_website_content"),
          { url: company.websiteUrl!, maxPages: 5 },
        ),
      ).then(async (r) =>
        r
          ? { tool: "website", signals: await classifyWebsite(company, r) }
          : mark("get_company_website_content"),
      ),
    );
    tasks.push(
      run("extract_vacancies_from_company_site", () =>
        mcps.vacatures.extractVacanciesFromCompanySite(
          ctxFor("extract_vacancies_from_company_site"),
          { url: company.websiteUrl! },
        ),
      ).then((r) =>
        r
          ? { tool: "vacatures", signals: classifyVacatures(company, r) }
          : mark("extract_vacancies_from_company_site"),
      ),
    );
  }

  tasks.push(
    run("search_court_cases", () =>
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
    run("search_labor_inspections", () =>
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
    run("search_insolvencies", () =>
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
    run("search_company_news", () =>
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
  };

  function mark(tool: string): { tool: string; signals: Signaal[] } {
    failures.push(tool);
    return { tool, signals: [] };
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await withTimeout(fn(), TOOL_TIMEOUT_MS, label);
    } catch (err) {
      console.warn(`[orchestrator] ${label} faalde voor ${company.kvk}:`, err);
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
    cluster: typeof s.cluster === "number" ? s.cluster : null,
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
