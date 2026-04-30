// Cost tracking + budget guard voor de classifier-laag.
//
// Per search loopt er een CostTracker mee die alle LLM-calls
// aggregeert en (via persistRun) naar Supabase classification_runs
// pusht. Aan het eind schrijven we de totals naar search_queries.
//
// Pricing per 1M tokens — handmatig bijgehouden zodat we ook zonder
// dashboard een schatting hebben. Bron: Anthropic pricing page.
// Bijwerken bij Anthropic-prijswijziging of nieuwe model-revisies.

import type { SupabaseClient } from "@supabase/supabase-js";

type Pricing = {
  input: number; // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const PRICING: Record<string, Pricing> = {
  // Haiku 4.5 — default classifier
  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  // Fallback voor onbekende modellen — gebruikt Haiku-prijzen om geen
  // false-zero te tonen.
  default: {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
};

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function estimateCostUsd(
  model: string,
  usage: AnthropicUsage,
): number {
  const p = PRICING[model] ?? PRICING.default;
  const input = (usage.input_tokens ?? 0) / 1_000_000;
  const output = (usage.output_tokens ?? 0) / 1_000_000;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) / 1_000_000;
  return (
    input * p.input +
    output * p.output +
    cacheRead * p.cacheRead +
    cacheWrite * p.cacheWrite
  );
}

// KvK API tariefkaart (zie developers.kvk.nl pricing). Zoeken is gratis;
// Basisprofiel/Vestigingsprofiel/Naamgeving zijn €0.02 per call. We slaan
// USD op in de tracker — conversie via een vaste factor zodat het budget
// in MAX_COST_PER_SEARCH_USD blijft kloppen. Bij sterke EUR-USD-fluctuatie
// kan EUR_USD_RATE als env-override gezet worden.
const EUR_USD_RATE = (() => {
  const env = process.env.EUR_USD_RATE;
  const n = env ? Number(env) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1.1;
})();

const KVK_PRICE_EUR: Record<string, number> = {
  kvk_zoeken: 0,
  kvk_basisprofiel: 0.02,
  kvk_vestigingsprofiel: 0.02,
  kvk_naamgeving: 0.02,
  kvk_historie_snapshot: 0.02,
  pdok_geocode: 0,
  get_company_website_content: 0,
};

export function estimateKvkCostUsd(toolName: string): number {
  const eur = KVK_PRICE_EUR[toolName] ?? 0;
  return eur * EUR_USD_RATE;
}

/**
 * Convert intern-tracked USD-bedrag naar EUR voor display. Gebruikt
 * dezelfde EUR_USD_RATE zodat ronden van KvK-prijzen consistent blijft
 * (KvK €0.02 → tracker $0.022 → display €0.020).
 */
export function usdToEur(usd: number): number {
  return usd / EUR_USD_RATE;
}

export function formatEur(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "—";
  return `€${usdToEur(Number(usd)).toFixed(2)}`;
}

export type ClassifierRun = {
  searchQueryId: string | null;
  kvk: string | null;
  bronType: string;
  model: string;
  durationMs: number;
  usage: AnthropicUsage;
};

export class CostTracker {
  // LLM-classifier kosten + tokens.
  private llmUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private calls = 0;
  // KvK API kosten + call-counts (per tool). Zoeken is gratis maar tellen
  // we wel zodat observability ziet hoeveel queries er gedaan zijn.
  private kvkUsd = 0;
  private kvkCallsByTool = new Map<string, number>();
  private budgetExceeded = false;
  private readonly budgetUsd: number | null;

  constructor() {
    const env = process.env.MAX_COST_PER_SEARCH_USD;
    const parsed = env ? Number(env) : NaN;
    this.budgetUsd = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  record(run: ClassifierRun): number {
    const cost = estimateCostUsd(run.model, run.usage);
    this.llmUsd += cost;
    this.inputTokens += run.usage.input_tokens ?? 0;
    this.outputTokens += run.usage.output_tokens ?? 0;
    this.cacheReadTokens += run.usage.cache_read_input_tokens ?? 0;
    this.cacheCreationTokens += run.usage.cache_creation_input_tokens ?? 0;
    this.calls += 1;
    this.checkBudget();
    return cost;
  }

  recordKvkCall(toolName: string): number {
    const cost = estimateKvkCostUsd(toolName);
    this.kvkUsd += cost;
    this.kvkCallsByTool.set(
      toolName,
      (this.kvkCallsByTool.get(toolName) ?? 0) + 1,
    );
    this.checkBudget();
    return cost;
  }

  private checkBudget(): void {
    if (this.budgetUsd !== null && this.llmUsd + this.kvkUsd > this.budgetUsd) {
      this.budgetExceeded = true;
    }
  }

  shouldHalt(): boolean {
    return this.budgetExceeded;
  }

  snapshot(): {
    totalUsd: number;
    llmUsd: number;
    kvkUsd: number;
    calls: number;
    kvkCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    budgetExceeded: boolean;
    budgetUsd: number | null;
  } {
    let kvkCalls = 0;
    for (const n of this.kvkCallsByTool.values()) kvkCalls += n;
    return {
      totalUsd: this.llmUsd + this.kvkUsd,
      llmUsd: this.llmUsd,
      kvkUsd: this.kvkUsd,
      calls: this.calls,
      kvkCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheCreationTokens: this.cacheCreationTokens,
      budgetExceeded: this.budgetExceeded,
      budgetUsd: this.budgetUsd,
    };
  }
}

// Per-search context houdt tracker + (optioneel) supabase + searchQueryId
// vast. classifier-laag pikt 'm via AsyncLocalStorage zonder dat alle
// call-sites 'm hoeven door te geven.
import { AsyncLocalStorage } from "node:async_hooks";

export type SearchScope = {
  tracker: CostTracker;
  supabase: SupabaseClient | null;
  searchQueryId: string | null;
};

const scopeStorage = new AsyncLocalStorage<SearchScope>();

export function withSearchScope<T>(
  scope: SearchScope,
  fn: () => Promise<T>,
): Promise<T> {
  return scopeStorage.run(scope, fn);
}

export function currentScope(): SearchScope | null {
  return scopeStorage.getStore() ?? null;
}

export async function persistRun(
  run: ClassifierRun,
  costUsd: number,
): Promise<void> {
  const scope = currentScope();
  if (!scope?.supabase || !scope.searchQueryId) return;
  await scope.supabase.from("classification_runs").insert([
    {
      search_query_id: scope.searchQueryId,
      kvk: run.kvk,
      bron_type: run.bronType,
      model: run.model,
      input_tokens: run.usage.input_tokens ?? 0,
      output_tokens: run.usage.output_tokens ?? 0,
      cache_read_tokens: run.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: run.usage.cache_creation_input_tokens ?? 0,
      cost_usd: costUsd,
      duration_ms: run.durationMs,
    },
  ]);
}
