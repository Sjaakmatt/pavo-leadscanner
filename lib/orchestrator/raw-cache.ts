// Per-tool cache van de MEEST RECENTE ruwe MCP-response per bedrijf.
// Sla na iedere succesvolle scrape het ruwe payload op; bij een refresh
// kunnen we classifier-versies replayen zonder de MCP opnieuw te bevragen.
//
// Tabel: mcp_raw_responses (zie supabase/migrations/004).
// Strategie: upsert op (kvk, tool) zodat we maar één rij per combinatie
// onthouden. Voor lange-historie analyses voegen we later een
// append-only tabel toe.

import type { SupabaseClient } from "@supabase/supabase-js";

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
    .select("payload, fetched_at")
    .eq("kvk", kvk)
    .eq("tool", tool)
    .gte("fetched_at", cutoff)
    .maybeSingle();
  if (!data) return null;
  return data.payload as T;
}
