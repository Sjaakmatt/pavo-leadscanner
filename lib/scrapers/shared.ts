// Gedeelde types + helpers voor alle productie-scrapers in lib/scrapers/.
//
// We re-gebruiken de SignaalCategorie + cluster-mapping uit
// scrapers/shared/types.ts — dat is de bron van waarheid voor het
// signaal-framework. Deze module wrapt 'm voor server-side gebruik
// (import via relative path omdat tsconfig de scrapers/ folder exclude't
// maar de files wel bestaan; we importeren met explicit .ts extension
// zodat TypeScript ze ziet).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------- signal shape --------------------------------------------------

export type ClusterId = 1 | 2 | 3 | "context";

// Lijst in sync gehouden met scrapers/shared/types.ts — als die wordt
// uitgebreid, voeg hier dezelfde toe (of refactor later naar een
// gedeelde package).
export const CLUSTER_FOR: Record<string, ClusterId> = {
  geen_hr_rol_zichtbaar: 1,
  snelle_groei: 1,
  veel_functies_geen_structuur: 1,
  negatieve_reviews_chaos: 1,
  verzuim_burnout_signalen: 1,
  nieuwe_managementlaag: 1,
  internationale_uitbreiding: 1,
  arbeidsrechtzaak_recent: 1,
  arbeidsrechtzaak_patroon: 1,
  arbo_boete_recent: 1,
  arbeidsinspectie_stillegging: 1,
  asbest_overtreding: 1,
  veel_open_vacatures: 2,
  langlopende_vacatures: 2,
  herposte_vacatures: 2,
  hiring_manager_actief: 2,
  recruiter_overload: 2,
  seizoenspieken: 2,
  klein_team_in_groei: 3,
  geen_hr_finance_roles: 3,
  founder_run: 3,
  veel_freelancers: 3,
  loonadministratie_klachten: 3,
  nieuwe_bv: 3,
  bedrijfsomvang: "context",
  bestuursvorm: "context",
  sector_context: "context",
  failliet_of_surseance: "context",
};

export type ScraperSignal = {
  categorie: string;
  cluster: ClusterId;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
  bron_url?: string;
  bron_type: string;
};

export type ScraperRunResult = {
  signals: ScraperSignal[];
  method: "playwright" | "web_fetch" | "api" | "rss";
  success: boolean;
  error?: string;
  durationMs: number;
  cost: { inputTokens: number; outputTokens: number; usd: number };
  debug?: Record<string, unknown>;
};

export type CompanyForScraper = {
  kvk: string;
  naam: string;
  websiteUrl?: string;
  zoeknamen: string[];
};

// ---------- Anthropic ------------------------------------------------------

let cachedClient: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ontbreekt voor productie-scrapers.");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function scraperModel(): string {
  // Haiku 4.5 is goedkoop én snel voor classificatie op korte schone tekst.
  return process.env.SCRAPER_MODEL ?? "claude-haiku-4-5-20251001";
}

// Haiku 4.5 list price: $1 / MTok input, $5 / MTok output.
export function estimateUsd(input: number, output: number): number {
  return (input * 1) / 1_000_000 + (output * 5) / 1_000_000;
}

export function makeSignal(
  input: {
    categorie: string;
    sterkte: number;
    confidence: number;
    observatie: string;
    bewijs?: string[];
    bron_url?: string;
  },
  bronType: string,
): ScraperSignal {
  const cluster = CLUSTER_FOR[input.categorie] ?? "context";
  return {
    categorie: input.categorie,
    cluster,
    sterkte: clamp(input.sterkte, 0, 100),
    confidence: clamp(input.confidence, 0, 100),
    observatie: input.observatie,
    bewijs: input.bewijs,
    bron_url: input.bron_url,
    bron_type: bronType,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ---------- JSON extraction ------------------------------------------------

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const startObj = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  const first =
    startArr !== -1 && (startArr < startObj || startObj === -1)
      ? startArr
      : startObj;
  if (first === -1) throw new Error("Geen JSON in Claude-output");
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end === -1 || end < first) throw new Error("Ongeldige JSON-structuur");
  return JSON.parse(candidate.slice(first, end + 1)) as T;
}

export function textOfContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

// ---------- persistence ---------------------------------------------------

export async function persistScraperRun(
  supabase: SupabaseClient,
  kvk: string,
  scraperName: string,
  result: ScraperRunResult,
): Promise<string | null> {
  const startedAt = new Date(Date.now() - result.durationMs).toISOString();
  const { data: run, error: runErr } = await supabase
    .from("scrape_runs")
    .insert({
      kvk,
      scraper: scraperName,
      method: result.method,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      success: result.success,
      error: result.error,
      duration_ms: result.durationMs,
      cost_usd: result.cost.usd,
      input_tokens: result.cost.inputTokens,
      output_tokens: result.cost.outputTokens,
      debug: (result.debug ?? null) as object | null,
    })
    .select("id")
    .single();
  if (runErr) {
    console.warn(`scrape_runs insert faalde voor ${scraperName}: ${runErr.message}`);
    return null;
  }
  const runId = run.id as string;

  if (result.signals.length > 0) {
    const rows = result.signals.map((s) => ({
      scrape_run_id: runId,
      kvk,
      categorie: s.categorie,
      cluster: typeof s.cluster === "number" ? s.cluster : null,
      sterkte: s.sterkte,
      confidence: s.confidence,
      observatie: s.observatie,
      bewijs: s.bewijs,
      bron_url: s.bron_url,
      bron_type: s.bron_type,
    }));
    const { error: sigErr } = await supabase.from("signals").insert(rows);
    if (sigErr) console.warn(`signals insert faalde: ${sigErr.message}`);
  }
  return runId;
}

export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label = "op",
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout na ${ms}ms`)), ms),
    ),
  ]);
}
