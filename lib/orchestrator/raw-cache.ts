// Per-tool cache van de MEEST RECENTE ruwe MCP-response per bedrijf.
// Sla na iedere succesvolle scrape het ruwe payload op; bij een refresh
// kunnen we classifier-versies replayen zonder de MCP opnieuw te bevragen.
//
// Tabel: mcp_raw_responses (zie supabase/migrations/004 + 016 voor
// schema_version-uitbreiding).
// Strategie: upsert op (kvk, tool) zodat we maar één rij per combinatie
// onthouden. Voor lange-historie analyses voegen we later een
// append-only tabel toe.
//
// Schema-versioning: payloads krijgen een `schema_version` mee. De
// reader vergelijkt met de huidige versie in lib/cache/schema-versions
// en treats outdated rijen als cache-miss zodat schema-bumps van een
// MCP automatisch leiden tot re-fetch (incremental enrichment).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentSchemaVersion,
  isCacheVersionStale,
} from "@/lib/cache/schema-versions";

export type CachedToolName =
  | "get_company_website_content"
  | "extract_vacancies_from_company_site"
  | "search_court_cases"
  | "search_labor_inspections"
  | "search_insolvencies"
  | "search_company_news";

export async function persistRaw(
  supabase: SupabaseClient,
  kvk: string,
  tool: CachedToolName,
  payload: unknown,
): Promise<void> {
  if (payload == null) return;
  const json = JSON.stringify(payload);
  const { error } = await supabase
    .from("mcp_raw_responses")
    .upsert(
      [
        {
          kvk,
          tool,
          payload,
          bytes: json.length,
          fetched_at: new Date().toISOString(),
          schema_version: currentSchemaVersion(tool),
        },
      ],
      { onConflict: "kvk,tool" },
    );
  if (error) {
    // best-effort — een falende cache mag de pipeline niet kapot maken
    console.warn(`[raw-cache] persist ${tool}/${kvk}: ${error.message}`);
  }
}

export async function readRaw<T>(
  supabase: SupabaseClient,
  kvk: string,
  tool: CachedToolName,
  maxAgeDays: number,
): Promise<T | null> {
  const cutoff = new Date(
    Date.now() - maxAgeDays * 86_400_000,
  ).toISOString();
  const { data } = await supabase
    .from("mcp_raw_responses")
    .select("payload, fetched_at, schema_version")
    .eq("kvk", kvk)
    .eq("tool", tool)
    .gte("fetched_at", cutoff)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    payload: unknown;
    fetched_at: string;
    schema_version?: number;
  };
  // Schema-staleness: zelfs binnen de TTL verklaren we de rij outdated
  // wanneer de MCP-tool sinds de cache-write een schema-bump heeft
  // gehad (bv. nieuwe contactPoints-veld). De caller behandelt 't dan
  // als miss en triggert een re-fetch.
  if (isCacheVersionStale(tool, row.schema_version ?? 0)) {
    return null;
  }
  return row.payload as T;
}

/**
 * Diagnose welke tools voor een lead nog stale-schema cache hebben (of
 * helemaal geen cache). Returnt de lijst tools die een refresh nodig
 * hebben. Gebruikt door enrichment-flow om gericht alleen die tools
 * opnieuw te draaien i.p.v. de hele scrape-batch.
 */
export async function detectStaleTools(
  supabase: SupabaseClient,
  kvk: string,
  tools: CachedToolName[],
  maxAgeDays: number,
): Promise<CachedToolName[]> {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("mcp_raw_responses")
    .select("tool, fetched_at, schema_version")
    .eq("kvk", kvk)
    .in("tool", tools);
  const rows = (data ?? []) as Array<{
    tool: CachedToolName;
    fetched_at: string;
    schema_version: number | null;
  }>;
  const byTool = new Map(rows.map((r) => [r.tool, r]));
  const stale: CachedToolName[] = [];
  for (const tool of tools) {
    const row = byTool.get(tool);
    if (!row) {
      stale.push(tool); // nooit gefetched
      continue;
    }
    if (row.fetched_at < cutoff) {
      stale.push(tool); // TTL verlopen
      continue;
    }
    if (isCacheVersionStale(tool, row.schema_version ?? 0)) {
      stale.push(tool); // schema-bump sinds cache-write
      continue;
    }
  }
  return stale;
}
