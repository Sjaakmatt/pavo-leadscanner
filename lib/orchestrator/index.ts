// Orchestrator: voert per bedrijf de 6 productieklare scrapers parallel
// uit, persisteert elke run + alle signalen, retourneert de totale kosten
// zodat de caller de budget-limiet kan bewaken. Scraper 05 (Indeed) is
// bewust uitgesloten — in dry-runs bewezen niet-werkbaar.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  persistScraperRun,
  withTimeout,
  type CompanyForScraper,
  type ScraperRunResult,
} from "@/lib/scrapers/shared";
import { runWebsiteScraper } from "@/lib/scrapers/website";
import { runRechtspraakScraper } from "@/lib/scrapers/rechtspraak";
import { runNlaScraper } from "@/lib/scrapers/nla";
import { runInsolventieScraper } from "@/lib/scrapers/insolventie";
import { runNewsScraper } from "@/lib/scrapers/news";
import { runVacaturesScraper } from "@/lib/scrapers/vacatures";

type ScraperEntry = {
  name: string;
  run: (c: CompanyForScraper) => Promise<ScraperRunResult>;
  timeoutMs: number;
};

const SCRAPERS: ScraperEntry[] = [
  { name: "01-website", run: runWebsiteScraper, timeoutMs: 60_000 },
  { name: "02-rechtspraak", run: runRechtspraakScraper, timeoutMs: 45_000 },
  { name: "03-nla", run: runNlaScraper, timeoutMs: 60_000 },
  { name: "04-insolventie", run: runInsolventieScraper, timeoutMs: 45_000 },
  { name: "06-news", run: runNewsScraper, timeoutMs: 30_000 },
  { name: "07-vacatures", run: runVacaturesScraper, timeoutMs: 75_000 },
];

// Draait alle 6 scrapers parallel voor één bedrijf. Elke scraper heeft
// een eigen timeout; valt er één om, dan blijven de anderen doorlopen.
// Returns: totale kosten in USD.
export async function runScrapersForCompany(
  company: CompanyForScraper,
  supabase: SupabaseClient,
): Promise<number> {
  const settled = await Promise.allSettled(
    SCRAPERS.map(async (s) => {
      try {
        const result = await withTimeout(s.run(company), s.timeoutMs, s.name);
        await persistScraperRun(supabase, company.kvk, s.name, result);
        return result;
      } catch (err) {
        const timeoutResult: ScraperRunResult = {
          signals: [],
          method: "playwright",
          success: false,
          error: String(err),
          durationMs: s.timeoutMs,
          cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
        };
        await persistScraperRun(supabase, company.kvk, s.name, timeoutResult);
        return timeoutResult;
      }
    }),
  );
  return settled.reduce((sum, s) => {
    if (s.status !== "fulfilled") return sum;
    return sum + (s.value?.cost?.usd ?? 0);
  }, 0);
}
