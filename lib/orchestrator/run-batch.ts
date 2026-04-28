// Concurrency-cap voor scrape-and-classify over meerdere bedrijven.
//
// Default: 5 bedrijven tegelijk. Hoger en de MCP queues lopen vol +
// Anthropic rate-limits worden geraakt; lager en searches worden traag.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/mcp/client";
import {
  scrapeAndClassifyCompany,
  type CompanyHandle,
  type OrchestrationResult,
  type ScrapeMcps,
} from "./scrape-and-classify";

export type BatchProgress = (event: {
  kvk: string;
  done: number;
  total: number;
  durationMs: number;
  signalCount: number;
  failures: string[];
}) => void;

export async function runScrapeBatch(
  companies: CompanyHandle[],
  ctx: TenantContext,
  mcps: ScrapeMcps,
  supabase: SupabaseClient,
  opts: {
    concurrency?: number;
    onProgress?: BatchProgress;
    shouldAbort?: () => boolean;
  } = {},
): Promise<OrchestrationResult[]> {
  const concurrency = opts.concurrency ?? 5;
  const queue = [...companies];
  const results: OrchestrationResult[] = [];
  let done = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        if (opts.shouldAbort?.()) return;
        const company = queue.shift();
        if (!company) return;
        const result = await scrapeAndClassifyCompany(
          company,
          ctx,
          mcps,
          supabase,
        );
        results.push(result);
        done += 1;
        opts.onProgress?.({
          kvk: company.kvk,
          done,
          total: companies.length,
          durationMs: result.durationMs,
          signalCount: result.signalen.length,
          failures: result.failures,
        });
      }
    },
  );

  await Promise.all(workers);
  return results;
}
